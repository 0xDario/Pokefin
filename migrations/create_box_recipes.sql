-- Migration: Create box_recipes table for Box NAV Calculator
-- The `packs` column stores an array of {set_id, quantity} objects as JSONB.

CREATE TABLE public.box_recipes (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid,
  name text NOT NULL,
  retail_price double precision NOT NULL CHECK (retail_price >= 0),
  promo_value double precision NOT NULL DEFAULT 0 CHECK (promo_value >= 0),
  packs jsonb NOT NULL DEFAULT '[]'::jsonb,
  share_code text UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT box_recipes_pkey PRIMARY KEY (id),
  CONSTRAINT box_recipes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- Index for fast lookups by user and share code
CREATE INDEX box_recipes_user_id_idx ON public.box_recipes (user_id);
CREATE INDEX box_recipes_share_code_idx ON public.box_recipes (share_code) WHERE share_code IS NOT NULL;

-- RLS policies
ALTER TABLE public.box_recipes ENABLE ROW LEVEL SECURITY;

-- Anyone can read recipes that have a share_code (public shared recipes)
CREATE POLICY "Shared recipes are viewable by everyone"
  ON public.box_recipes FOR SELECT
  USING (share_code IS NOT NULL);

-- Authenticated users can read their own recipes
CREATE POLICY "Users can view their own recipes"
  ON public.box_recipes FOR SELECT
  USING (auth.uid() = user_id);

-- Authenticated users can insert their own recipes
CREATE POLICY "Users can create their own recipes"
  ON public.box_recipes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Authenticated users can update their own recipes
CREATE POLICY "Users can update their own recipes"
  ON public.box_recipes FOR UPDATE
  USING (auth.uid() = user_id);

-- Authenticated users can delete their own recipes
CREATE POLICY "Users can delete their own recipes"
  ON public.box_recipes FOR DELETE
  USING (auth.uid() = user_id);
