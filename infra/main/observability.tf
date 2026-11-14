# Observabilité du jeu : le serveur écrit ses événements (packages/server/src/telemetry.ts) dans
# /var/log/arena/events.log, que l'agent CloudWatch envoie dans ce groupe (deploy/observability). Des filtres en tirent
# cinq métriques (espace WinOrWipe), affichées avec des requêtes Logs Insights sur le tableau de bord « win-or-wipe ».
# Aucune donnée personnelle : ni IP, ni pseudo, ni identifiant durable.
locals {
  metrics_namespace = "WinOrWipe"

  # Métrique => filtre et valeur. Un « joueur actif » a fait au moins 5 actions dans sa partie.
  game_metrics = {
    PlayersOnline  = { pattern = "{ $.event = \"snapshot\" }", value = "$.online" }
    PlayersInMatch = { pattern = "{ $.event = \"snapshot\" }", value = "$.in_match" }
    PlayClicks     = { pattern = "{ $.event = \"join\" }", value = "1" }
    MatchesStarted = { pattern = "{ $.event = \"match_start\" }", value = "1" }
    ActivePlayers  = { pattern = "{ ($.event = \"player_result\") && ($.active = 1) }", value = "1" }
  }
}

resource "aws_cloudwatch_log_group" "events" {
  name              = "/arena/events"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_metric_filter" "game" {
  for_each = local.game_metrics

  name           = each.key
  log_group_name = aws_cloudwatch_log_group.events.name
  pattern        = each.value.pattern

  metric_transformation {
    name      = each.key
    namespace = local.metrics_namespace
    value     = each.value.value
    unit      = "Count"
  }
}

locals {
  dashboard_source = "SOURCE '${aws_cloudwatch_log_group.events.name}'"

  metric_widget = {
    online = {
      title   = "Joueurs connectés et en partie (max. sur 5 min)"
      stat    = "Maximum"
      period  = 300
      metrics = ["PlayersOnline", "PlayersInMatch"]
    }
    activity = {
      title   = "Clics sur « Jouer », parties lancées, joueurs actifs (par heure)"
      stat    = "Sum"
      period  = 3600
      metrics = ["PlayClicks", "MatchesStarted", "ActivePlayers"]
    }
  }

  log_widgets = [
    {
      title = "Joueurs et joueurs actifs, par jour"
      query = "filter event = \"player_result\" | stats count(*) as joueurs, sum(active) as actifs, avg(actions) as actions_moyennes by bin(1d)"
    },
    {
      title = "Classes jouées par les joueurs actifs"
      query = "filter event = \"player_result\" and active = 1 | stats count(*) as joueurs by class | sort joueurs desc"
    },
    {
      title = "Parties : fin (fin, abandon, arrêt du serveur), vainqueur (0 = bleus, 1 = rouges), durée, humains"
      query = "filter event = \"match_end\" | stats count(*) as parties, avg(seconds) as duree_moyenne_s, avg(humans_start) as humains_moyens, avg(active_humans) as actifs_moyens by reason, winner"
    },
    {
      title = "Fin de partie des joueurs (fin, parti, chargement trop long, arrêt du serveur)"
      query = "filter event = \"player_result\" | stats count(*) as joueurs, avg(seconds) as presence_moyenne_s by left"
    },
    {
      title = "Navigateurs (clics sur « Jouer »)"
      query = "filter event = \"join\" | stats count(*) as clics by browser, mobile | sort clics desc"
    },
  ]
}

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "win-or-wipe"
  dashboard_body = jsonencode({
    # Une semaine par défaut (les tableaux « par jour », classes, navigateurs n'auraient sinon que les 3 dernières heures).
    start = "-P7D"
    widgets = concat(
      [for i, key in ["online", "activity"] : {
        type   = "metric"
        x      = 12 * i
        y      = 0
        width  = 12
        height = 6
        properties = {
          title   = local.metric_widget[key].title
          region  = var.region
          view    = "timeSeries"
          stacked = false
          stat    = local.metric_widget[key].stat
          period  = local.metric_widget[key].period
          metrics = [for name in local.metric_widget[key].metrics : [local.metrics_namespace, name]]
        }
      }],
      [for i, widget in local.log_widgets : {
        type   = "log"
        x      = 12 * (i % 2)
        y      = 6 + 6 * floor(i / 2)
        width  = 12
        height = 6
        properties = {
          title  = widget.title
          region = var.region
          view   = "table"
          query  = "${local.dashboard_source} | ${widget.query}"
        }
      }],
    )
  })
}
