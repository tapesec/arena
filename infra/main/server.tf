# Serveur de jeu (Colyseus, qui sert aussi le client). Pas de SSH : accès par Session Manager. Le logiciel est
# installé au déploiement, pas ici.

# Dernière image Amazon Linux 2023 ARM (lue par ec2:DescribeImages, permis au rôle du plan des PR, contrairement à
# la lecture des paramètres SSM).
data "aws_ami" "al2023_arm64" {
  owners      = ["amazon"]
  most_recent = true

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-kernel-6.*-arm64"]
  }

  filter {
    name   = "architecture"
    values = ["arm64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_security_group" "server" {
  name        = "arena-server"
  description = "Game server: HTTPS from Cloudflare only"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "arena-server"
  }
}

# HTTPS seulement : Cloudflare joint le serveur en « Full (strict) » avec un certificat Origin CA (pages et WebSocket).
resource "aws_vpc_security_group_ingress_rule" "server" {
  for_each = toset(local.cloudflare_ipv4)

  security_group_id = aws_security_group.server.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = each.value
  description       = "Cloudflare"
}

# Sorties : mises à jour du système, Session Manager, téléchargement des versions du jeu.
resource "aws_vpc_security_group_egress_rule" "server" {
  security_group_id = aws_security_group.server.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
  description       = "All outbound"
}

resource "aws_iam_role" "server" {
  name        = "arena-server"
  description = "Game server instance role (Session Manager)"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "server_ssm" {
  role       = aws_iam_role.server.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "server" {
  name = "arena-server"
  role = aws_iam_role.server.name
}

resource "aws_instance" "server" {
  ami                    = data.aws_ami.al2023_arm64.id
  instance_type          = var.server_instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.server.id]
  iam_instance_profile   = aws_iam_instance_profile.server.name

  credit_specification {
    cpu_credits = "unlimited"
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.server_volume_gb
    encrypted             = true
    delete_on_termination = true
  }

  tags = {
    Name = "arena-server"
  }

  # Une nouvelle image Amazon Linux ne remplace pas le serveur en marche : les mises à jour passent par dnf.
  lifecycle {
    ignore_changes = [ami]
  }
}

# Adresse publique fixe (cible des entrées DNS de Cloudflare), conservée si le serveur est recréé.
resource "aws_eip" "server" {
  domain = "vpc"

  tags = {
    Name = "arena-server"
  }
}

resource "aws_eip_association" "server" {
  allocation_id = aws_eip.server.id
  instance_id   = aws_instance.server.id
}
