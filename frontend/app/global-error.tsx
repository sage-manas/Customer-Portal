"use client";

/**
 * Root-layout backstop. Per Next's error.md, `error.tsx` "does not wrap the
 * layout.js or template.js above it in the same segment" — so nothing else in
 * app/ can catch a failure in the root layout.
 *
 * It replaces the document and does NOT receive global styles, so the colours
 * here are inline literals rather than design tokens. Keep it dependency-free:
 * anything it imports is another thing that can fail at the same moment.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#fff",
          color: "#111",
        }}
      >
        <main style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>CustomerConnect is unavailable</h1>
          <p style={{ fontSize: 13, color: "#555", margin: "0 0 16px" }}>
            Something failed while loading the application shell.
          </p>
          {error.digest ? (
            <p style={{ fontSize: 11, fontFamily: "monospace", color: "#888" }}>
              Reference: {error.digest}
            </p>
          ) : null}
          <button
            onClick={() => retry()}
            style={{ padding: "8px 16px", fontSize: 13, cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
