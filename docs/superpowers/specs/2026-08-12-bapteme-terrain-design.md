# Baptême terrain — Design

Date : 2026-08-12
Statut : validé (brainstorming avec Tom)

## Objectif

Outiller le « baptême terrain » : depuis un point d'intérêt (personne, voiture ou
domicile) placé sur la carte, identifier chaque route qui en part — un « axe » —
pour pouvoir annoncer à la radio la direction prise par la personne en quittant
la position (« il sort du bâtiment, il prend TION AUCHAN »). Un axe va du point
jusqu'à la **prochaine intersection** seulement.

## Décisions de cadrage

- **Un seul point à la fois** : personne OU voiture OU maison, pas les trois.
  Placer un nouveau baptême remplace l'ancien (avec confirmation).
- **Un seul baptême actif par mission**, partagé avec toute l'équipe
  (persistance backend + sync socket, même mécanique que les zones).
- **Identifiant radio = le nom TION** (repère unique : enseigne, commune…).
  Les couleurs sont une aide visuelle, pas l'identifiant.
- **Source de données routières : Overpass API (OSM)** — gratuit, sans clé.
  Le calcul n'a lieu qu'une fois, chez le créateur ; le backend ne stocke que
  le résultat. Aucun autre client ne dépend d'Overpass.
- **Deux phases** : phase 1 = icône + axes colorés automatiques + renommage
  manuel ; phase 2 = suggestion automatique des noms TION.

## Flux utilisateur

1. Bouton « Baptême » dans la toolbar droite de la carte.
2. Sélecteur d'icône (personne / voiture / maison), tap sur la carte pour
   placer le point (draggable avant validation, comme un brouillon de POI).
3. À la validation : requête Overpass, calcul des axes, couleurs attribuées,
   (phase 2) noms suggérés. Résultat sauvegardé et diffusé à l'équipe.
4. Tap sur un axe → renommer (suggestions en phase 2, saisie libre toujours
   possible), changer la couleur, supprimer cet axe.
5. Tap long sur l'icône → supprimer le baptême entier.

## Modes d'affichage

Champ `displayMode` sur le baptême, modifiable à tout moment. Couleurs et noms
sont toujours stockés ; le mode ne change que le rendu.

- **`colors`** : chevrons colorés (suite de flèches discontinues) le long de la
  géométrie réelle de l'axe. La forme « chevrons » est choisie précisément pour
  ne jamais être confondue avec les tracés GPS de l'équipe (lignes continues).
- **`tion`** : une seule flèche orientée dans le sens de l'axe + étiquette
  « TION <NOM> » — l'équivalent du feutre sur carte papier.
- **`both`** : chevrons colorés + flèche/étiquette TION superposés.

## Modèle de données

Nouveau modèle Mongoose `Baptism` (un document par mission) :

```
{
  missionId, createdBy,
  icon: 'person' | 'car' | 'house',
  point: { lng, lat },
  displayMode: 'colors' | 'tion' | 'both',
  axes: [{
    axisId, color,
    name: string | null,        // "AUCHAN" → affiché "TION AUCHAN"
    suggestions: string[],      // phase 2
    geometry: LineString,       // du point projeté à la prochaine intersection
    bearing: number             // azimut sortant, pour la flèche TION
  }]
}
```

## Backend

`routes/baptisms.ts`, calqué sur `routes/zones.ts` :

- `GET /missions/:id/baptism` — chargement au join mission.
- `PUT /missions/:id/baptism` — créer/remplacer (le client envoie le résultat
  calculé : point, axes, géométries).
- `PATCH /missions/:id/baptism` — renommer/recolorer/supprimer un axe, changer
  `displayMode`.
- `DELETE /missions/:id/baptism`.

Mêmes gardes que les zones (auth + membre de mission), mêmes événements socket
pour la diffusion temps réel.

## Calcul des axes (client créateur)

1. **Requête Overpass** : `way[highway]` avec géométrie dans un rayon de 250 m
   autour du point. Filtre selon l'icône : voiture → routes carrossables ;
   personne/maison → aussi chemins, sentiers, pistes.
2. **Projection** : le point placé (bâtiment, parking) est projeté sur la route
   la plus proche.
3. **Marche du graphe** : les ways OSM partagent des identifiants de nœuds ;
   un nœud présent dans plusieurs ways = intersection. Depuis le point projeté,
   marcher dans chaque direction disponible jusqu'à la première intersection
   (ou cul-de-sac), garde-fou à 1,5 km. Chaque marche = un axe.
4. **Couleurs** : palette fixe de 10 couleurs très contrastées, attribuées dans
   l'ordre des azimuts (sens horaire depuis le nord). Au-delà de 10 branches,
   recyclage — le nom reste l'identifiant.

## Suggestion des noms TION (phase 2)

Une requête Overpass supplémentaire : repères nommés dans un rayon de 2 km
(place=city/town/village/hamlet, shop nommés, stations-service, mairies,
églises, écoles…). Pour chaque axe, candidats dans le cône ±35° autour de
l'azimut de l'axe, classés par saillance radio :

1. enseignes et stations-service (« TION AUCHAN »),
2. bâtiments publics (mairie, église, école),
3. prochaine commune ou lieu-dit,
4. repli : nom/numéro de la route (« TION D45 »), sinon point cardinal
   (« TION NORD-EST »).

Meilleur candidat pré-rempli, top 3 en suggestions, saisie libre possible.

## Cas d'erreur

- **Overpass indisponible** : 3 miroirs publics essayés en cascade ; si échec,
  l'icône reste placée avec un bouton « relancer le calcul ».
- **Aucune route à 250 m** : élargissement unique à 500 m, sinon message clair.
- **Hors-ligne** : message net — la création exige du réseau (la sync équipe
  aussi).

## Tests

- Unitaires vitest sur fixtures Overpass figées (aucun appel réseau) :
  croisement en T, carrefour en X, projection en milieu de segment, cul-de-sac,
  rond-point ; classement de saillance des noms ; maths d'azimut/cône.
- Backend : tests de route comme `zones.test.ts` — gardes d'auth, sémantique de
  remplacement (PUT), renommage d'axe (PATCH).
