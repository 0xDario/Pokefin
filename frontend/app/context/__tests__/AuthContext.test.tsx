/**
 * AuthContext tests after the server-route auth refactor.
 *
 * The provider now talks to /api/auth/{me,sign-in,sign-up,sign-out,
 * update-password} via fetch for every session-changing operation;
 * `supabase` is only used for the profiles SELECT and the (email-only)
 * resetPasswordForEmail call.
 */

import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import { AuthProvider, useAuth } from "../AuthContext";

interface MockUser {
  id: string;
  email: string;
  user_metadata?: { username?: string };
}

const mockResetPasswordForEmail = jest.fn();
const mockMaybeSingle = jest.fn();
const mockFrom = jest.fn();
const mockSelect = jest.fn();
const mockEq = jest.fn();

jest.mock("../../lib/supabase", () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: (email: string) => mockResetPasswordForEmail(email),
    },
    from: (table: string) => mockFrom(table),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockFrom.mockReturnValue({ select: mockSelect });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockEq.mockReturnValue({ maybeSingle: mockMaybeSingle });
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  // Default: /api/auth/me returns no user.
  setFetchResponse({ ok: true, json: { user: null } });
});

// Minimal fetch mock helper
type FetchResponseSpec = {
  ok: boolean;
  status?: number;
  json?: unknown;
};

const fetchMock = jest.fn();

function setFetchResponse(spec: FetchResponseSpec) {
  fetchMock.mockResolvedValue({
    ok: spec.ok,
    status: spec.status ?? (spec.ok ? 200 : 400),
    json: async () => spec.json ?? {},
  });
}

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
});

function TestConsumer({ onRender }: { onRender?: (auth: ReturnType<typeof useAuth>) => void }) {
  const auth = useAuth();
  if (onRender) onRender(auth);
  return (
    <div>
      <span data-testid="loading">{auth.loading.toString()}</span>
      <span data-testid="user">{auth.user?.email ?? "no-user"}</span>
      <span data-testid="profile">{auth.profile?.username ?? "no-profile"}</span>
    </div>
  );
}

function renderWithProvider(ui: React.ReactElement = <TestConsumer />) {
  return render(<AuthProvider>{ui}</AuthProvider>);
}

async function renderWithProviderAndWait(ui: React.ReactElement = <TestConsumer />) {
  const renderResult = renderWithProvider(ui);
  await waitFor(() => {
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
  });
  return renderResult;
}

describe("AuthContext", () => {
  describe("init via /api/auth/me", () => {
    it("starts in loading state", () => {
      setFetchResponse({ ok: true, json: { user: null } });
      renderWithProvider();
      expect(screen.getByTestId("loading")).toHaveTextContent("true");
    });

    it("ends with no user when /api/auth/me returns null", async () => {
      setFetchResponse({ ok: true, json: { user: null } });
      await renderWithProviderAndWait();
      expect(screen.getByTestId("user")).toHaveTextContent("no-user");
    });

    it("populates user when /api/auth/me returns a user", async () => {
      const u: MockUser = { id: "user-123", email: "test@example.com" };
      setFetchResponse({ ok: true, json: { user: u } });
      mockMaybeSingle.mockResolvedValue({
        data: { id: "user-123", username: "testuser", email: "test@example.com" },
        error: null,
      });
      await renderWithProviderAndWait();
      expect(screen.getByTestId("user")).toHaveTextContent("test@example.com");
      expect(screen.getByTestId("profile")).toHaveTextContent("testuser");
    });

    it("treats a 401 from /api/auth/me as signed out", async () => {
      setFetchResponse({ ok: false, status: 401, json: { error: "Unauthorized" } });
      await renderWithProviderAndWait();
      expect(screen.getByTestId("user")).toHaveTextContent("no-user");
    });
  });

  describe("signIn", () => {
    it("POSTs to /api/auth/sign-in with the CSRF header and sets user on 200", async () => {
      // Init returns no user.
      setFetchResponse({ ok: true, json: { user: null } });
      let capturedAuth: ReturnType<typeof useAuth> | null = null;
      await renderWithProviderAndWait(
        <TestConsumer onRender={(auth) => { capturedAuth = auth; }} />
      );

      const signedInUser: MockUser = { id: "u1", email: "user@example.com" };
      // Next two fetches: sign-in POST + (no /api/auth/me follow-up; setUser sets directly)
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ user: signedInUser }),
      });

      let result: { error: unknown } | null = null;
      await act(async () => {
        result = await capturedAuth!.signIn("user@example.com", "pw", "captcha-token");
      });

      expect(result!.error).toBeNull();
      const [url, init] = fetchMock.mock.calls.at(-1)!;
      expect(url).toBe("/api/auth/sign-in");
      expect((init as RequestInit).method).toBe("POST");
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers["x-pokefin-request"]).toBe("1");
      expect(headers["Content-Type"]).toBe("application/json");
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        email: "user@example.com",
        password: "pw",
        captchaToken: "captcha-token",
      });
    });

    it("returns an AuthError-shaped object on non-2xx", async () => {
      setFetchResponse({ ok: true, json: { user: null } });
      let capturedAuth: ReturnType<typeof useAuth> | null = null;
      await renderWithProviderAndWait(
        <TestConsumer onRender={(auth) => { capturedAuth = auth; }} />
      );

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: "Invalid credentials" }),
      });

      let result: { error: { message?: string } | null } = { error: null };
      await act(async () => {
        result = await capturedAuth!.signIn("wrong@example.com", "bad");
      });

      expect(result.error?.message).toBe("Invalid credentials");
    });
  });

  describe("signUp", () => {
    it("POSTs to /api/auth/sign-up and includes the username + captcha", async () => {
      setFetchResponse({ ok: true, json: { user: null } });
      let capturedAuth: ReturnType<typeof useAuth> | null = null;
      await renderWithProviderAndWait(
        <TestConsumer onRender={(auth) => { capturedAuth = auth; }} />
      );

      const newUser: MockUser = { id: "u-new", email: "new@example.com" };
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ user: newUser }),
      });

      await act(async () => {
        await capturedAuth!.signUp("new@example.com", "pw", "newuser", "captcha-x");
      });

      const [url, init] = fetchMock.mock.calls.at(-1)!;
      expect(url).toBe("/api/auth/sign-up");
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        email: "new@example.com",
        password: "pw",
        username: "newuser",
        captchaToken: "captcha-x",
      });
    });
  });

  describe("signOut", () => {
    it("POSTs to /api/auth/sign-out and clears user / profile", async () => {
      const u: MockUser = { id: "u1", email: "test@example.com" };
      setFetchResponse({ ok: true, json: { user: u } });
      mockMaybeSingle.mockResolvedValue({
        data: { id: "u1", username: "testuser", email: "test@example.com" },
        error: null,
      });
      let capturedAuth: ReturnType<typeof useAuth> | null = null;
      await renderWithProviderAndWait(
        <TestConsumer onRender={(auth) => { capturedAuth = auth; }} />
      );

      // Wait for the profile fetch to land so the assertion below is meaningful.
      await waitFor(() => {
        expect(screen.getByTestId("user")).toHaveTextContent("test@example.com");
      });

      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });

      await act(async () => {
        await capturedAuth!.signOut();
      });

      expect(fetchMock.mock.calls.at(-1)![0]).toBe("/api/auth/sign-out");
      expect(screen.getByTestId("user")).toHaveTextContent("no-user");
      expect(screen.getByTestId("profile")).toHaveTextContent("no-profile");
    });
  });

  describe("updatePassword", () => {
    it("POSTs to /api/auth/update-password and returns null error on 200", async () => {
      setFetchResponse({ ok: true, json: { user: null } });
      let capturedAuth: ReturnType<typeof useAuth> | null = null;
      await renderWithProviderAndWait(
        <TestConsumer onRender={(auth) => { capturedAuth = auth; }} />
      );

      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });

      let result: { error: unknown } | null = null;
      await act(async () => {
        result = await capturedAuth!.updatePassword("newSecurePassword123");
      });

      expect(result!.error).toBeNull();
      const [url, init] = fetchMock.mock.calls.at(-1)!;
      expect(url).toBe("/api/auth/update-password");
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        password: "newSecurePassword123",
      });
    });
  });

  describe("resetPassword", () => {
    it("still calls supabase.auth.resetPasswordForEmail (browser-safe)", async () => {
      setFetchResponse({ ok: true, json: { user: null } });
      mockResetPasswordForEmail.mockResolvedValue({ error: null });

      let capturedAuth: ReturnType<typeof useAuth> | null = null;
      await renderWithProviderAndWait(
        <TestConsumer onRender={(auth) => { capturedAuth = auth; }} />
      );

      await act(async () => {
        await capturedAuth!.resetPassword("reset@example.com");
      });

      expect(mockResetPasswordForEmail).toHaveBeenCalledWith("reset@example.com");
    });
  });

  describe("context surface", () => {
    it("does not expose `session` (raw token object) on the hook return", async () => {
      setFetchResponse({ ok: true, json: { user: null } });
      let capturedAuth: ReturnType<typeof useAuth> | null = null;
      await renderWithProviderAndWait(
        <TestConsumer onRender={(auth) => { capturedAuth = auth; }} />
      );
      expect(capturedAuth).toHaveProperty("user");
      expect(capturedAuth).toHaveProperty("profile");
      expect(capturedAuth).not.toHaveProperty("session");
      expect(capturedAuth).toHaveProperty("loading");
      expect(typeof capturedAuth!.signUp).toBe("function");
      expect(typeof capturedAuth!.signIn).toBe("function");
      expect(typeof capturedAuth!.signOut).toBe("function");
      expect(typeof capturedAuth!.resetPassword).toBe("function");
      expect(typeof capturedAuth!.updatePassword).toBe("function");
    });

    it("throws if used outside an AuthProvider", () => {
      const spy = jest.spyOn(console, "error").mockImplementation(() => {});
      expect(() => render(<TestConsumer />)).toThrow(
        "useAuth must be used within an AuthProvider"
      );
      spy.mockRestore();
    });
  });
});
