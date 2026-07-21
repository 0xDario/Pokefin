-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.exchange_rates (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  usd_to_cad double precision NOT NULL,
  recorded_at timestamp without time zone DEFAULT now(),
  CONSTRAINT exchange_rates_pkey PRIMARY KEY (id)
);
CREATE TABLE public.generations (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  name text NOT NULL UNIQUE,
  CONSTRAINT generations_pkey PRIMARY KEY (id)
);
CREATE TABLE public.portfolio_holdings (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  portfolio_id bigint NOT NULL,
  product_id bigint NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  purchase_price_usd double precision NOT NULL CHECK (purchase_price_usd >= 0::double precision),
  purchase_date date NOT NULL,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT portfolio_holdings_pkey PRIMARY KEY (id),
  CONSTRAINT portfolio_holdings_portfolio_id_fkey FOREIGN KEY (portfolio_id) REFERENCES public.portfolios(id),
  CONSTRAINT portfolio_holdings_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id)
);
CREATE TABLE public.portfolio_lots (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  holding_id bigint NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  purchase_price_usd double precision NOT NULL CHECK (purchase_price_usd >= 0::double precision),
  purchase_date date NOT NULL,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT portfolio_lots_pkey PRIMARY KEY (id),
  CONSTRAINT portfolio_lots_holding_id_fkey FOREIGN KEY (holding_id) REFERENCES public.portfolio_holdings(id)
);
CREATE TABLE public.portfolios (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL DEFAULT 'My Portfolio'::text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT portfolios_pkey PRIMARY KEY (id),
  CONSTRAINT portfolios_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.product_price_history (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  product_id bigint,
  usd_price double precision NOT NULL CHECK (usd_price IS NULL OR usd_price > 0::double precision),
  recorded_at timestamp without time zone DEFAULT now(),
  CONSTRAINT product_price_history_pkey PRIMARY KEY (id),
  CONSTRAINT product_price_history_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id)
);
CREATE TABLE public.product_types (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  name text NOT NULL UNIQUE,
  label text,
  CONSTRAINT product_types_pkey PRIMARY KEY (id)
);
CREATE TABLE public.products (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  set_id bigint,
  product_type_id bigint,
  usd_price double precision,
  url text,
  last_updated timestamp without time zone DEFAULT now(),
  image_url text,
  last_image_update timestamp with time zone,
  variant text,
  sku text UNIQUE,
  CONSTRAINT products_pkey PRIMARY KEY (id),
  CONSTRAINT products_product_type_id_fkey FOREIGN KEY (product_type_id) REFERENCES public.product_types(id),
  CONSTRAINT products_set_id_fkey FOREIGN KEY (set_id) REFERENCES public.sets(id)
);
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  username text UNIQUE,
  email text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
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
CREATE TABLE public.sets (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  generation_id bigint,
  code text NOT NULL,
  name text NOT NULL,
  release_date date,
  expansion_type character varying CHECK (expansion_type::text = ANY (ARRAY['Main Series'::character varying::text, 'Special Expansion'::character varying::text, 'Subset'::character varying::text, 'Starter Set'::character varying::text])),
  CONSTRAINT sets_pkey PRIMARY KEY (id),
  CONSTRAINT sets_generation_id_fkey FOREIGN KEY (generation_id) REFERENCES public.generations(id)
);
-- Sales-volume + listings-depth tables (context only; created by
-- migrations/0015_product_sales_and_listings_history.sql).
CREATE TABLE public.product_sales_history (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  product_id bigint NOT NULL,
  bucket_date date NOT NULL,
  granularity text NOT NULL DEFAULT 'day'::text,
  quantity_sold integer,
  transaction_count integer,
  low_sale_price double precision,
  high_sale_price double precision,
  market_price double precision,
  recorded_at timestamp without time zone DEFAULT now(),
  CONSTRAINT product_sales_history_pkey PRIMARY KEY (id),
  CONSTRAINT product_sales_history_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id),
  CONSTRAINT product_sales_history_granularity_sane CHECK (granularity = ANY (ARRAY['day'::text, 'week'::text])),
  CONSTRAINT product_sales_history_quantity_sane CHECK (quantity_sold IS NULL OR (quantity_sold >= 0 AND quantity_sold <= 1000000)),
  CONSTRAINT product_sales_history_tx_count_sane CHECK (transaction_count IS NULL OR (transaction_count >= 0 AND transaction_count <= 1000000)),
  CONSTRAINT product_sales_history_low_price_sane CHECK (low_sale_price IS NULL OR low_sale_price > 0::double precision),
  CONSTRAINT product_sales_history_high_price_sane CHECK (high_sale_price IS NULL OR high_sale_price > 0::double precision),
  CONSTRAINT product_sales_history_market_price_sane CHECK (market_price IS NULL OR market_price > 0::double precision),
  CONSTRAINT product_sales_history_product_bucket_uidx UNIQUE (product_id, bucket_date, granularity)
);
CREATE TABLE public.product_listings_history (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  product_id bigint NOT NULL,
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  active_listings integer,
  total_quantity_available integer,
  lowest_listing_price double precision,
  recorded_at timestamp without time zone DEFAULT now(),
  CONSTRAINT product_listings_history_pkey PRIMARY KEY (id),
  CONSTRAINT product_listings_history_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id),
  CONSTRAINT product_listings_history_active_listings_sane CHECK (active_listings IS NULL OR active_listings >= 0),
  CONSTRAINT product_listings_history_total_quantity_sane CHECK (total_quantity_available IS NULL OR total_quantity_available >= 0),
  CONSTRAINT product_listings_history_lowest_price_sane CHECK (lowest_listing_price IS NULL OR lowest_listing_price > 0::double precision),
  CONSTRAINT product_listings_history_product_snapshot_uidx UNIQUE (product_id, snapshot_date)
);