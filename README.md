# GeoGN

Application de suivi de localisation en temps réel avec création de zones géographiques.

## Fonctionnalités

- Authentification des utilisateurs (email/mot de passe)
- Suivi de localisation en temps réel avec géolocalisation GPS
- Affichage des utilisateurs actifs sur une carte interactive
- Traces colorées montrant le parcours de chaque utilisateur
- Création de zones géographiques personnalisées
- Mise à jour en temps réel avec Supabase Realtime

## Configuration

1. Créez un projet Supabase sur [https://supabase.com](https://supabase.com)

2. Copiez vos clés d'API Supabase et mettez-les dans le fichier `.env`:

```env
VITE_SUPABASE_URL=votre_url_supabase
VITE_SUPABASE_ANON_KEY=votre_clé_anon_supabase
```

3. La base de données a été créée automatiquement avec les tables:
   - `zones` - Stocke les zones géographiques créées
   - `user_locations` - Positions actuelles des utilisateurs
   - `location_trails` - Historique des déplacements (traces)

4. Installez les dépendances:
```bash
npm install
```

5. Lancez l'application en mode développement:
```bash
npm run dev
```

## Utilisation

1. Créez un compte ou connectez-vous
2. Cliquez sur "Démarrer le suivi" pour activer votre géolocalisation
3. Votre position apparaîtra sur la carte et une trace colorée sera créée lors de vos déplacements
4. Pour créer une zone:
   - Cliquez sur "Créer une zone"
   - Cliquez sur la carte pour définir les points de la zone
   - Cliquez sur "Terminer la zone" et donnez-lui un nom
5. Les autres utilisateurs connectés apparaîtront en gris sur la carte avec leurs traces

## Couleurs

- Bleu: Votre position et votre trace
- Gris foncé: Autres utilisateurs
- Blanc: Arrière-plan et éléments d'interface

## Technologies

- React + TypeScript
- Vite
- Tailwind CSS
- Leaflet (cartes interactives)
- Supabase (base de données + auth + realtime)
- Lucide React (icônes)
