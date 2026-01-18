# Trafic routier et poursuite véhicule (road_graph)

Ce document décrit l’architecture attendue pour le moteur `road_graph`,
le trafic TomTom et le microservice `road-graph`.

## 1. Vue d’ensemble

- Le backend GeoGN calcule les pistes véhicule toutes les 60s via
  `vehicleTrackScheduler.ts`.
- Deux algorithmes sont possibles sur une piste véhicule :
  - `mvp_isoline` : cercle simple basé sur une vitesse moyenne.
  - `road_graph` : propagation sur graphe + trafic temps réel.
- Le frontend anime la progression entre deux ticks backend.

## 2. Variables d’environnement

Côté backend :

- `TRAFFIC_PROVIDER` : `tomtom` ou `none`.
- `TOMTOM_API_KEY` : clé API TomTom Traffic Flow (backend uniquement).

Quand `TRAFFIC_PROVIDER=tomtom`, le moteur `road_graph` doit utiliser
TomTom pour ajuster la vitesse effective dans les tuiles actives.

## 3. TomTom – modèle de facturation

- Il faut créer un compte développeur TomTom.
- L’API Traffic Flow est facturée à l’appel (avec un quota gratuit de
  démarrage, voir la documentation TomTom).
- Sur le dashboard TomTom, tu peux suivre :
  - le nombre de requêtes par jour/mois,
  - les éventuels dépassements de quota.

Recommandation :

- Définir un TTL court pour le cache trafic (ex: 30–60s) et un plafond
  global par tick (`MAX_TOMTOM_CALLS_PER_TICK`) pour éviter les coûts
  inattendus.

## 4. Microservice road-graph

Le backend GeoGN **ne parle pas directement** à OSRM/Valhalla. Il
parle à un microservice HTTP `road-graph` qui wrappe le moteur choisi.

Endpoints attendus :

- `GET /snap?lng=&lat=&profile=car|motorcycle|scooter|truck`
  - Réponse : `{ lng: number; lat: number }` (point snappé).
- `GET /tile?z=&x=&y=&profile=`
  - Réponse :
    ```json
    {
      "z": 14,
      "x": 8592,
      "y": 5723,
      "edges": [
        {
          "id": "edge-123",
          "fromNodeId": "n1",
          "toNodeId": "n2",
          "lengthMeters": 123.4,
          "geometry": { "type": "LineString", "coordinates": [[lng, lat], ...] },
          "roadClass": "residential",
          "oneway": true,
          "speedLimitKmh": 50
        }
      ]
    }
    ```

C’est ce contrat qui est reflété dans `backend/src/traffic/roadGraphProvider.ts`.

## 5. Intégration actuelle

- `backend/src/traffic/computeVehicleRoadGraph.ts` expose
  `computeVehicleRoadGraph`, appelé par `vehicleTrackScheduler.ts` quand
  `algorithm === 'road_graph'`.
- L’implémentation actuelle :
  - gère un état persistant minimal (`VehicleRoadGraphState`) pour les
    tuiles et le cache trafic,
  - calcule une vitesse effective tenant compte du trafic et du type de
    véhicule (avec overspeed capé),
  - produit pour l’instant une géométrie de type cercle (héritée du
    fallback isoline) en attendant la propagation complète "poulpe" sur
    graphe.

L’objectif est ensuite de remplacer ce cercle par :

- chargement des edges par tuiles via `RoadGraphProvider`,
- propagation multi-front (Dijkstra temps-dépendant),
- marquage `ACTIVE/DONE` des tuiles en fonction de la couverture
  routable.

## 6. docker-compose (exemple)

Le fichier `docker-compose.yml` contient un bloc **commenté** qui
décrit une stack possible :

- `backend` (GeoGN API),
- `frontend` (UI),
- `mongo` (stockage),
- `road-graph` (microservice HTTP),
- `osrm-backend` (moteur de graphe OSM sous-jacent).

Décommente et adapte ces services selon ton environnement (chemins
OSRM, images Docker, ports, etc.).
