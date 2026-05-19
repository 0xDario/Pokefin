"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html>
      <body>
        <div style={{ padding: "2rem", textAlign: "center" }}>
          <h1>Something went wrong</h1>
          <p>An unexpected error occurred. Please refresh.</p>
          <button onClick={reset}>Try again</button>
        </div>
      </body>
    </html>
  );
}
