This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Building without a Supabase project

Five pages (`/`, `/prices`, `/market`, `/stats`, `/analytics`) are prerendered and query Supabase at build time, so a plain `pnpm build` needs real `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_KEY` values. To check that the app builds without them (this is what CI runs):

```bash
pnpm build:stub
```

It starts `scripts/supabase-stub.mjs` (answers every Supabase REST call with an empty result) on a free local port, runs `next build` against it, stops it, and prints which Supabase endpoints the build called. No Supabase project, secrets or `.env.local` are needed, but the build still downloads the Geist fonts from Google Fonts (`next/font/google`), so it needs internet access. The resulting `.next/` has empty pages: never deploy it, and do not expect market data from `next start` after it. The script wipes `.next/cache/fetch-cache` before and after so stub results cannot leak into a later real build.

`pnpm test:scripts` runs the stub's own tests (`node --test`; Jest ignores `scripts/`).

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
