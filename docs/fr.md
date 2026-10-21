# Template de démonstration

Ceci est la documentation utilisateur de l'intégration. Gladys ré-héberge ce
fichier et affiche un lien **Documentation** permanent vers lui dans l'écran
de configuration (dans la langue de l'utilisateur, avec l'anglais en repli) —
c'est au moment de configurer que l'utilisateur en a le plus besoin. Gardez
les courtes indications d'accueil dans les blocs `section` du `config_schema`
du manifest ; mettez ici le pas-à-pas détaillé (captures d'écran, dépannage…).

## Ce que vous obtenez

Six appareils de démonstration apparaissent après l'installation : une
station météo (vraies données Open-Meteo), un interrupteur, une lampe
variable, une prise connectée avec mesure de puissance, un détecteur de
mouvement et une caméra.

## Configuration

1. Ouvrez l'onglet **Configuration** de l'intégration.
2. Renseignez la **latitude** et la **longitude** que la station météo de
   démonstration doit observer (Paris par défaut), et choisissez votre unité
   de température. L'**intervalle de rafraîchissement** règle la fréquence
   de lecture de la station météo et de la puissance de la prise : toutes
   les 5 minutes par défaut, toutes les minutes au plus.
3. Enregistrez : les appareils apparaissent dans l'onglet **Découverte**,
   prêts à être ajoutés.

Le réglage **Préférer la connexion locale** pilote la prise de
démonstration : elle affiche en badge le canal réellement utilisé (local ou
cloud), avec un point orange quand elle fonctionne en mode dégradé (local
refusé, bascule cloud).

## Actions

- **Tester le fournisseur météo** — effectue une requête en direct vers
  Open-Meteo et affiche la température et l'humidité actuelles sous le
  bouton.
- **Identifier un appareil** — choisissez un de vos appareils dans la liste
  et il se signale (la lampe de démonstration « clignote » dans les logs).

## Scènes

L'intégration ajoute ses propres cartes à l'éditeur de scènes (Gladys 5.1
ou plus récent), dans la catégorie **Intégrations** :

- **Mouvement détecté** (déclencheur) — lance la scène quand un détecteur
  de démonstration voit bouger quelque chose. Choisissez éventuellement le
  détecteur et ce qui a bougé (personne, animal) ; laissés vides, toute
  détection correspond. Les actions suivantes peuvent lire ce qui a bougé
  avec `{{triggerEvent.data.target}}`.
- **Identifier un appareil** (action) — fait se signaler l'appareil choisi.
  Elle indique si l'appareil a pu se signaler, pour que les actions
  suivantes puissent en dépendre.

## Tableau de bord

Ajoutez le widget **État de la démo** à un tableau de bord : il affiche en
direct la température de la station météo et la puissance de la prise du
bureau, la connexion utilisée par la prise (en orange si dégradée) et la
position observée. Son bouton **Identifier la lampe** fait se signaler la
lampe de démonstration.

## Dépannage

L'intégration journalise tout ce qu'elle fait : consultez les logs de
l'intégration depuis l'interface Gladys (ou `docker logs` sur l'hôte) avec
`LOG_LEVEL=debug` pour le détail complet.
