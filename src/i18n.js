// -----------------------------------------------------------------------------
// Names and messages, French and English.
// -----------------------------------------------------------------------------

export const word = (entry, language) => entry?.[language] ?? entry?.en ?? '';

/** An entry whose values are functions -> the entry of their results. */
export const fill = (entry, ...args) =>
  Object.fromEntries(
    Object.entries(entry).map(([lang, value]) => [
      lang,
      typeof value === 'function' ? value(...args) : value,
    ]),
  );

export const DEVICE_NAMES = {
  panel: { fr: 'Centrale Visonic', en: 'Visonic panel' },
  zone: { fr: (n) => `Zone ${n}`, en: (n) => `Zone ${n}` },
};

export const FEATURE_NAMES = {
  online: { fr: 'Centrale connectée', en: 'Panel connected' },
  mode: { fr: 'État', en: 'State' },
  armed: { fr: 'Armée', en: 'Armed' },
  ready: { fr: 'Prête à armer', en: 'Ready to arm' },
  trouble: { fr: 'Défaut en cours', en: 'Trouble' },
  'panel-tamper': { fr: 'Autoprotection centrale', en: 'Panel tamper' },
  alarm: { fr: 'Alarme en cours', en: 'Alarm in progress' },
  'fire-alarm': { fr: 'Alarme incendie', en: 'Fire alarm' },
  'arm-away': { fr: 'Armement total', en: 'Arm away' },
  'arm-stay': { fr: 'Armement partiel', en: 'Arm stay' },
  disarm: { fr: 'Désarmer', en: 'Disarm' },
  kind: {
    opening: { fr: 'Ouverture', en: 'Opening' },
    motion: { fr: 'Mouvement', en: 'Motion' },
    smoke: { fr: 'Fumée', en: 'Smoke' },
    leak: { fr: "Fuite d'eau", en: 'Water leak' },
  },
  tamper: { fr: 'Autoprotection', en: 'Tamper' },
  battery: { fr: 'Pile faible', en: 'Low battery' },
  'zone-alarm': { fr: 'Alarme', en: 'Alarm' },
  bypass: { fr: 'Exclue', en: 'Bypassed' },
};

/** The text of the read-only state feature of the panel. */
export const MODE_NAMES = {
  disarmed: { fr: 'Désarmée', en: 'Disarmed' },
  arming: { fr: 'Armement en cours', en: 'Arming' },
  entry_delay: { fr: "Délai d'entrée", en: 'Entry delay' },
  armed_away: { fr: 'Armée (totale)', en: 'Armed (away)' },
  armed_stay: { fr: 'Armée (partielle)', en: 'Armed (stay)' },
  programming: { fr: 'Programmation', en: 'Programming' },
  unknown: { fr: 'Inconnu', en: 'Unknown' },
};

const nothing = { fr: " : rien n'a été envoyé.", en: ': nothing was sent.' };

const seconds = (ms) => Math.max(1, Math.round(ms / 1000));

/** Connection status and command messages. */
export const T = {
  noHost: {
    en: 'Enter the address of the network adapter of the panel in the configuration.',
    fr: "Saisissez l'adresse de l'adaptateur réseau de la centrale dans la configuration.",
  },
  noPort: {
    en: 'Enter the TCP port of the network adapter in the configuration.',
    fr: "Saisissez le port TCP de l'adaptateur réseau dans la configuration.",
  },
  connecting: {
    en: 'Connecting to the Visonic panel…',
    fr: 'Connexion à la centrale Visonic…',
  },
  waiting: {
    en: (ms) => `Waiting before connecting to the panel again: next try in ${seconds(ms)} s.`,
    fr: (ms) =>
      `Attente avant de se reconnecter à la centrale : nouvel essai dans ${seconds(ms)} s.`,
  },
  connected: {
    en: (mode, zones) => `Connected to the Visonic panel (${mode}), ${zones} zone(s).`,
    fr: (mode, zones) => `Connecté à la centrale Visonic (${mode}), ${zones} zone(s).`,
  },
  codeStopped: {
    en: ' The panel refused the user code: commands stopped until the code is changed or "Allow a new try of the code" is clicked.',
    fr: ' La centrale a refusé le code utilisateur : commandes arrêtées jusqu’à un changement du code ou un clic sur « Autoriser un nouvel essai du code ».',
  },
  unreachable: {
    en: (reason, ms) => `Visonic panel unreachable (${reason}), next try in ${seconds(ms)} s.`,
    fr: (reason, ms) =>
      `Centrale Visonic injoignable (${reason}), nouvel essai dans ${seconds(ms)} s.`,
  },
  silent: {
    en: (ms) =>
      `The adapter accepts the connection but no status comes from the panel: check the wiring, the serial settings of the adapter (9600 bauds, 8N1 on most panels) and that no other software holds it. Next try in ${seconds(ms)} s.`,
    fr: (ms) =>
      `L'adaptateur accepte la connexion mais aucun état n'arrive de la centrale : vérifiez le câblage, les réglages série de l'adaptateur (9600 bauds, 8N1 sur la plupart des centrales) et qu'aucun autre logiciel ne l'occupe. Nouvel essai dans ${seconds(ms)} s.`,
  },
  offline: {
    en: `The panel is not connected${nothing.en}`,
    fr: `La centrale n'est pas connectée${nothing.fr}`,
  },
  noCode: {
    en: `Enter a user code in the configuration to control the alarm${nothing.en}`,
    fr: `Saisissez un code utilisateur dans la configuration pour piloter l'alarme${nothing.fr}`,
  },
  badCode: {
    en: `The user code of the configuration must be 4 digits${nothing.en}`,
    fr: `Le code utilisateur de la configuration doit compter 4 chiffres${nothing.fr}`,
  },
  codeRefusedBefore: {
    en: `The panel refused this user code before: change it in the configuration, or click "Allow a new try of the code"${nothing.en}`,
    fr: `La centrale a déjà refusé ce code utilisateur : changez-le dans la configuration, ou cliquez sur « Autoriser un nouvel essai du code »${nothing.fr}`,
  },
  disarmRefused: {
    en: `Disarming from Gladys is disabled in the configuration${nothing.en}`,
    fr: `Le désarmement depuis Gladys est désactivé dans la configuration${nothing.fr}`,
  },
  programming: {
    en: `The panel is in programming (installer menu or download)${nothing.en}`,
    fr: `La centrale est en programmation (menu installateur ou téléchargement)${nothing.fr}`,
  },
  armCovered: {
    en: `An arming at least as strong was just sent, or the panel is already armed so${nothing.en}`,
    fr: `Un armement au moins aussi fort vient d'être envoyé, ou la centrale est déjà armée ainsi${nothing.fr}`,
  },
  preempted: {
    en: `An arming in progress took the line while this disarm waited for the state${nothing.en}`,
    fr: `Un armement en cours a pris la ligne pendant que ce désarmement attendait l'état${nothing.fr}`,
  },
  uncertainAfterDisarm: {
    en: 'A disarm sent just before may still apply: the state is uncertain, it is read again in 2 s. Arm again if needed.',
    fr: "Un désarmement envoyé juste avant peut encore s'appliquer : l'état est incertain, il est relu dans 2 s. Réarmez si besoin.",
  },
  restarted: {
    en: `The connection to the panel restarted while the command was being prepared${nothing.en}`,
    fr: `La connexion à la centrale a redémarré pendant la préparation de la commande${nothing.fr}`,
  },
  stateUnknown: {
    en: `The current state could not be read from the panel${nothing.en}`,
    fr: `L'état actuel n'a pas pu être relu sur la centrale${nothing.fr}`,
  },
  tooLate: {
    en: `The panel answered too slowly to send the command in time${nothing.en}`,
    fr: `La centrale a répondu trop lentement pour envoyer la commande à temps${nothing.fr}`,
  },
  codeRefused: {
    en: (what) =>
      `The panel refused the user code (${what}). Commands are stopped until the code is changed or "Allow a new try of the code" is clicked.`,
    fr: (what) =>
      `La centrale a refusé le code utilisateur (${what}). Les commandes sont arrêtées jusqu'à un changement du code ou un clic sur « Autoriser un nouvel essai du code ».`,
  },
  unconfirmed: {
    en: (what) =>
      `Sent to the panel (${what}), without confirmation in time: the state is read again in 2 s.`,
    fr: (what) =>
      `Envoyée à la centrale (${what}), sans confirmation dans les temps : l'état est relu dans 2 s.`,
  },
  notApplied: {
    en: (what) =>
      `Sent to the panel and acknowledged (${what}), but the state read back does not show it yet (a zone open, a trouble?): it is read again in 2 s.`,
    fr: (what) =>
      `Envoyée à la centrale et acquittée (${what}), mais l'état relu ne la montre pas encore (une zone ouverte, un défaut ?) : il est relu dans 2 s.`,
  },
  commandBusy: {
    en: `Other commands took all the time of this one before its turn came${nothing.en}`,
    fr: `D'autres commandes ont pris tout le temps de celle-ci avant son tour${nothing.fr}`,
  },
  disarmWithdrawn: {
    en: `An arming was asked while this disarming waited its turn${nothing.en}`,
    fr: `Un armement a été demandé pendant que ce désarmement attendait son tour${nothing.fr}`,
  },
  codeNotStopped: {
    en: 'The user code is not stopped: nothing to allow.',
    fr: "Le code utilisateur n'est pas arrêté : rien à autoriser.",
  },
  codeRetryAllowed: {
    en: 'The next command will send the user code again (once). Nothing was sent now.',
    fr: "La prochaine commande enverra de nouveau le code utilisateur (une fois). Rien n'a été envoyé maintenant.",
  },
};

/** What a command does, for the logs and the messages. */
export const COMMAND_NAMES = {
  armed_away: { en: 'arm away', fr: 'armement total' },
  armed_stay: { en: 'arm stay', fr: 'armement partiel' },
  disarmed: { en: 'disarm', fr: 'désarmement' },
};
