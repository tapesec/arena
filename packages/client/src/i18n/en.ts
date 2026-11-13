// Textes du jeu en anglais (langue par défaut). C'est la référence : fr.ts doit avoir exactement les mêmes clés.
// {nom} : valeur insérée à l'affichage (voir t()).
export const en = {
  // Accueil
  "home.tagline": "8v8 group PvP",
  "home.language": "Language",
  "home.name": "Player name",
  "home.nameHint": "Letters, digits and @ · {max} characters max",
  "home.play": "Play",
  "home.creditsMusic": "Music:",
  "home.creditsIcons": "Icons:",
  "home.creditsSounds": "Sounds:",
  "home.creditsVoices": "combat voices",
  "home.and": "and",

  // Connexion
  "connect.server": "Connecting to the server…",
  "connect.match": "Joining the match…",
  "connect.error": "Unable to connect: {message}",
  "connect.back": "Back",

  // Équipes
  "team.0": "Blue",
  "team.1": "Red",

  // Salle d'attente
  "lobby.title": "Choose your class",
  "lobby.team": "Team",
  "lobby.startsIn": "The match starts in",
  "lobby.full": "Match is full.",
  "lobby.players": "{humans} / {total} players on your team · empty slots are filled by bots.",
  "lobby.hp": "HP",
  "lobby.yourTeam": "Your team",
  "lobby.you": "you",
  "lobby.leader": "leader",
  "lobby.bot": "bot",
  "lobby.choosing": "choosing…",
  "lobby.leaderHint": "You are the team leader: you choose the bots' classes.",
  "lobby.hidden": "The enemy lineup stays hidden until you meet.",
  "lobby.forceStart": "Start now (test)",
  "lobby.leave": "Leave the queue",

  // Ressources
  "resource.mana": "Mana",
  "resource.endurance": "Endurance",

  // Ponctuation
  "punct.colon": ": ",

  // Combat
  "match.preparation": "Preparation: the fight starts in",
  "match.dead": "You are dead",
  "match.spectator": "Spectator mode",
  "match.spectatorHint": "{up}{left}{down}{right} moves the camera · V: back to your body",
  "end.draw": "Draw",
  "end.victory": "Victory!",
  "end.defeat": "Defeat",
  "end.winner": "Team {team} wins the match.",
  "end.newMatch": "New match",
  "end.home": "Main menu",

  // Cadres et cible
  "frame.attack": "Attack",
  "frame.face": "Face",
  "frame.stick": "Stick",
  "frame.dead": "Dead",
  "frame.you": "You",
  "frame.outOfSight": "No line of sight",
  "frame.notFacing": "Not facing",
  "frame.inMelee": "In melee range",

  // Son
  "sound.unmute": "Unmute",
  "sound.mute": "Mute",
  "sound.volume": "Volume",

  // Aide des commandes
  "help.show": "Show controls",
  "help.hide": "Hide controls",
  "help.label": "Game controls",
  "help.move": "{up}/{down}: forward/back · {left}/{right}: turn",
  "help.mouse": "Hold right mouse button: mouse steers (up/down: pitch) · {left}/{right}: strafe",
  "help.target": "Tab: next enemy · click: target · F1: target self · Esc: cancel",
  "help.lock": "F: face the target · C: follow it (stick)",
  "help.attack": "R: toggle auto-attack · mouse wheel: zoom · V: reset camera",
  "help.abilities": "1–9, 0: abilities",
};

export type TextKey = keyof typeof en;
