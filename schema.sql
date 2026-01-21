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