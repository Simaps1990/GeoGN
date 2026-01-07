/*
  # GeoGN Database Schema

  ## Overview
  Creates the database schema for GeoGN location tracking application with zones, 
  real-time user locations, and movement trails.

  ## New Tables
  
  ### `zones`
  - `id` (uuid, primary key) - Unique zone identifier
  - `name` (text) - Zone name
  - `description` (text, nullable) - Zone description
  - `geometry` (geography) - Zone boundary (polygon)
  - `color` (text) - Zone display color
  - `created_by` (uuid) - User who created the zone
  - `created_at` (timestamptz) - Creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### `user_locations`
  - `id` (uuid, primary key) - Unique location record identifier
  - `user_id` (uuid) - User identifier
  - `latitude` (double precision) - Current latitude
  - `longitude` (double precision) - Current longitude
  - `accuracy` (double precision, nullable) - GPS accuracy in meters
  - `heading` (double precision, nullable) - Direction of movement
  - `speed` (double precision, nullable) - Speed in m/s
  - `is_active` (boolean) - Whether user is currently sharing location
  - `updated_at` (timestamptz) - Last position update

  ### `location_trails`
  - `id` (uuid, primary key) - Unique trail point identifier
  - `user_id` (uuid) - User identifier
  - `latitude` (double precision) - Position latitude
  - `longitude` (double precision) - Position longitude
  - `recorded_at` (timestamptz) - When this position was recorded
  - `trail_color` (text) - Color of the trail segment

  ## Security
  - Enable RLS on all tables
  - Users can create and manage their own zones
  - Users can read all zones
  - Users can update their own location
  - Users can read all active user locations and trails
  - Users can only delete their own location data

  ## Extensions
  - Enable PostGIS for geographic data handling
*/

-- Enable PostGIS extension for geographic data
CREATE EXTENSION IF NOT EXISTS postgis;

-- Create zones table
CREATE TABLE IF NOT EXISTS zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  geometry geography(Polygon, 4326) NOT NULL,
  color text DEFAULT '#3B82F6',
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create user_locations table for current positions
CREATE TABLE IF NOT EXISTS user_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  accuracy double precision,
  heading double precision,
  speed double precision,
  is_active boolean DEFAULT true,
  updated_at timestamptz DEFAULT now()
);

-- Create location_trails table for movement history
CREATE TABLE IF NOT EXISTS location_trails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  recorded_at timestamptz DEFAULT now(),
  trail_color text DEFAULT '#3B82F6'
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_user_locations_user_id ON user_locations(user_id);
CREATE INDEX IF NOT EXISTS idx_user_locations_active ON user_locations(is_active);
CREATE INDEX IF NOT EXISTS idx_location_trails_user_id ON location_trails(user_id);
CREATE INDEX IF NOT EXISTS idx_location_trails_recorded_at ON location_trails(recorded_at);
CREATE INDEX IF NOT EXISTS idx_zones_created_by ON zones(created_by);

-- Enable Row Level Security
ALTER TABLE zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_trails ENABLE ROW LEVEL SECURITY;

-- RLS Policies for zones table
CREATE POLICY "Users can view all zones"
  ON zones FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can create zones"
  ON zones FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update own zones"
  ON zones FOR UPDATE
  TO authenticated
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can delete own zones"
  ON zones FOR DELETE
  TO authenticated
  USING (auth.uid() = created_by);

-- RLS Policies for user_locations table
CREATE POLICY "Users can view all active locations"
  ON user_locations FOR SELECT
  TO authenticated
  USING (is_active = true);

CREATE POLICY "Users can insert own location"
  ON user_locations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own location"
  ON user_locations FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own location"
  ON user_locations FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for location_trails table
CREATE POLICY "Users can view all trails"
  ON location_trails FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert own trail"
  ON location_trails FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own trail"
  ON location_trails FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);