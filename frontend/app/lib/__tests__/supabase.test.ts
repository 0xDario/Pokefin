/**
 * Tests for Supabase client initialization
 *
 * Note: The supabase.ts module is a simple client factory that creates a Supabase
 * client using environment variables. Since it's a direct export with side effects,
 * testing focuses on verifying the module structure and mock behavior.
 *
 * REFACTORING SUGGESTIONS:
 * - Consider wrapping the client creation in a function to allow dependency injection
 * - Add a factory function that accepts URL and key as parameters for testability
 */

// Store original env
const originalEnv = { ...process.env };

// Set up env vars BEFORE any imports
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test-project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_KEY = "test-anon-key-12345";
});

afterAll(() => {
  process.env = originalEnv;
});

// Mock the Supabase SSR browser client. The app moved from
// @supabase/supabase-js createClient to @supabase/ssr
// createBrowserClient (HttpOnly-cookie sessions, PKCE).
const mockCreateClient: jest.Mock = jest.fn(() => ({
  auth: {
    getSession: jest.fn(),
    getUser: jest.fn(),
    signUp: jest.fn(),
    signInWithPassword: jest.fn(),
    signOut: jest.fn(),
    onAuthStateChange: jest.fn(),
    resetPasswordForEmail: jest.fn(),
    updateUser: jest.fn(),
  },
  from: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(),
  })),
}));

jest.mock("@supabase/ssr", () => ({
  createBrowserClient: (...args: unknown[]) => mockCreateClient(...args),
}));

describe("Supabase Client", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createClient initialization", () => {
    it("should create a Supabase client with environment variables", async () => {
      // Re-import to trigger createClient
      jest.resetModules();
      const { supabase } = await import("../supabase");

      expect(mockCreateClient).toHaveBeenCalledWith(
        "https://test-project.supabase.co",
        "test-anon-key-12345",
        { auth: { flowType: "pkce" } }
      );
      expect(supabase).toBeDefined();
    });

    it("should export a valid supabase client object", async () => {
      jest.resetModules();
      const { supabase } = await import("../supabase");

      expect(supabase).toHaveProperty("auth");
      expect(supabase).toHaveProperty("from");
    });

    it("should have auth methods available on the client", async () => {
      jest.resetModules();
      const { supabase } = await import("../supabase");

      expect(supabase.auth).toHaveProperty("getSession");
      expect(supabase.auth).toHaveProperty("signUp");
      expect(supabase.auth).toHaveProperty("signInWithPassword");
      expect(supabase.auth).toHaveProperty("signOut");
      expect(supabase.auth).toHaveProperty("onAuthStateChange");
    });

    it("should have database query methods available", async () => {
      jest.resetModules();
      const { supabase } = await import("../supabase");

      expect(typeof supabase.from).toBe("function");
    });
  });

  describe("environment variable handling", () => {
    it("should use NEXT_PUBLIC_SUPABASE_URL for the URL", async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://custom-url.supabase.co";
      jest.resetModules();

      await import("../supabase");

      expect(mockCreateClient).toHaveBeenCalledWith(
        "https://custom-url.supabase.co",
        expect.any(String),
        expect.any(Object)
      );
    });

    it("should use NEXT_PUBLIC_SUPABASE_KEY for the anon key", async () => {
      process.env.NEXT_PUBLIC_SUPABASE_KEY = "custom-anon-key";
      jest.resetModules();

      await import("../supabase");

      expect(mockCreateClient).toHaveBeenCalledWith(
        expect.any(String),
        "custom-anon-key",
        expect.any(Object)
      );
    });
  });

  describe("client singleton behavior", () => {
    it("should return the same client instance on multiple imports", async () => {
      jest.resetModules();
      const { supabase: client1 } = await import("../supabase");
      const { supabase: client2 } = await import("../supabase");

      // Since the module is cached, both imports should reference the same object
      expect(client1).toBe(client2);
    });
  });
});
