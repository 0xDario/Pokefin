/**
 * Comprehensive tests for AuthContext and AuthProvider
 *
 * These tests cover:
 * - AuthProvider initialization and state management
 * - Authentication methods (signUp, signIn, signOut)
 * - Password management (resetPassword, updatePassword)
 * - Profile fetching
 * - useAuth hook behavior
 * - Error handling
 * - Auth state change subscription
 */

import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import { AuthProvider, useAuth } from "../AuthContext";

// Types for mock data
interface MockUser {
  id: string;
  email: string;
  user_metadata?: {
    username?: string;
  };
}

interface MockSession {
  user: MockUser;
  access_token: string;
}

// Mock Supabase client
const mockUnsubscribe = jest.fn();
const mockOnAuthStateChange = jest.fn(() => ({
  data: {
    subscription: {
      unsubscribe: mockUnsubscribe,
    },
  },
}));

const mockGetSession = jest.fn();
const mockSignUp = jest.fn();
const mockSignInWithPassword = jest.fn();
const mockSignOut = jest.fn();
const mockResetPasswordForEmail = jest.fn();
const mockUpdateUser = jest.fn();
const mockFrom = jest.fn();
const mockSelect = jest.fn();
const mockEq = jest.fn();
const mockSingle = jest.fn();
const mockInsert = jest.fn();

jest.mock("../../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      signUp: (params: { email: string; password: string; options?: object }) =>
        mockSignUp(params),
      signInWithPassword: (params: { email: string; password: string }) =>
        mockSignInWithPassword(params),
      signOut: () => mockSignOut(),
      onAuthStateChange: (callback: (event: string, session: MockSession | null) => void) =>
        mockOnAuthStateChange(callback),
      resetPasswordForEmail: (email: string, options: object) =>
        mockResetPasswordForEmail(email, options),
      updateUser: (params: { password: string }) => mockUpdateUser(params),
    },
    from: (table: string) => mockFrom(table),
  },
}));

// Setup mock chain for database queries
beforeEach(() => {
  mockFrom.mockReturnValue({
    select: mockSelect,
    insert: mockInsert,
  });
  mockSelect.mockReturnValue({
    eq: mockEq,
  });
  mockEq.mockReturnValue({
    single: mockSingle,
  });
  mockInsert.mockResolvedValue({ data: null, error: null });
});

// Test component that consumes the auth context
function TestConsumer({ onRender }: { onRender?: (auth: ReturnType<typeof useAuth>) => void }) {
  const auth = useAuth();
  if (onRender) {
    onRender(auth);
  }
  return (
    <div>
      <span data-testid="loading">{auth.loading.toString()}</span>
      <span data-testid="user">{auth.user?.email ?? "no-user"}</span>
      <span data-testid="profile">{auth.profile?.username ?? "no-profile"}</span>
      <span data-testid="session">{auth.session ? "has-session" : "no-session"}</span>
    </div>
  );
}

// Helper to render with provider
function renderWithProvider(ui: React.ReactElement = <TestConsumer />) {
  return render(<AuthProvider>{ui}</AuthProvider>);
}

describe("AuthContext", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default mock implementations
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    mockSingle.mockResolvedValue({
      data: null,
      error: null,
    });
  });

  describe("AuthProvider initialization", () => {
    it("should render children", async () => {
      renderWithProvider(
        <div data-testid="child">Child Content</div>
      );

      expect(screen.getByTestId("child")).toHaveTextContent("Child Content");
    });

    it("should start with loading state as true", () => {
      mockGetSession.mockReturnValue(new Promise(() => {})); // Never resolves

      renderWithProvider();

      expect(screen.getByTestId("loading")).toHaveTextContent("true");
    });

    it("should set loading to false after session check", async () => {
      mockGetSession.mockResolvedValue({
        data: { session: null },
        error: null,
      });

      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByTestId("loading")).toHaveTextContent("false");
      });
    });

    it("should initialize with null user when no session exists", async () => {
      mockGetSession.mockResolvedValue({
        data: { session: null },
        error: null,
      });

      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByTestId("user")).toHaveTextContent("no-user");
      });
    });

    it("should initialize user from existing session", async () => {
      const mockSession: MockSession = {
        user: { id: "user-123", email: "test@example.com" },
        access_token: "token-123",
      };
      mockGetSession.mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });
      mockSingle.mockResolvedValue({
        data: { id: "user-123", username: "testuser", email: "test@example.com" },
        error: null,
      });

      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByTestId("user")).toHaveTextContent("test@example.com");
      });
    });

    it("should fetch profile when session has user", async () => {
      const mockSession: MockSession = {
        user: { id: "user-456", email: "user@test.com" },
        access_token: "token-456",
      };
      mockGetSession.mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });
      mockSingle.mockResolvedValue({
        data: { id: "user-456", username: "profileuser", email: "user@test.com" },
        error: null,
      });

      renderWithProvider();

      await waitFor(() => {
        expect(mockFrom).toHaveBeenCalledWith("profiles");
        expect(mockSelect).toHaveBeenCalledWith("id, username, email");
        expect(mockEq).toHaveBeenCalledWith("id", "user-456");
      });

      await waitFor(() => {
        expect(screen.getByTestId("profile")).toHaveTextContent("profileuser");
      });
    });

    it("should subscribe to auth state changes on mount", async () => {
      renderWithProvider();

      await waitFor(() => {
        expect(mockOnAuthStateChange).toHaveBeenCalled();
      });
    });

    it("should unsubscribe from auth state changes on unmount", async () => {
      const { unmount } = renderWithProvider();

      await waitFor(() => {
        expect(mockOnAuthStateChange).toHaveBeenCalled();
      });

      unmount();

      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });

  describe("Auth state change handling", () => {
    it("should update user when auth state changes to signed in", async () => {
      let authStateCallback: ((event: string, session: MockSession | null) => void) | null = null;
      mockOnAuthStateChange.mockImplementation((callback) => {
        authStateCallback = callback;
        return {
          data: {
            subscription: { unsubscribe: mockUnsubscribe },
          },
        };
      });

      mockGetSession.mockResolvedValue({
        data: { session: null },
        error: null,
      });

      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByTestId("user")).toHaveTextContent("no-user");
      });

      // Simulate auth state change
      const newSession: MockSession = {
        user: { id: "new-user", email: "new@example.com" },
        access_token: "new-token",
      };
      mockSingle.mockResolvedValue({
        data: { id: "new-user", username: "newuser", email: "new@example.com" },
        error: null,
      });

      await act(async () => {
        if (authStateCallback) {
          authStateCallback("SIGNED_IN", newSession);
        }
      });

      await waitFor(() => {
        expect(screen.getByTestId("user")).toHaveTextContent("new@example.com");
      });
    });

    it("should clear user and profile when signed out", async () => {
      let authStateCallback: ((event: string, session: MockSession | null) => void) | null = null;
      mockOnAuthStateChange.mockImplementation((callback) => {
        authStateCallback = callback;
        return {
          data: {
            subscription: { unsubscribe: mockUnsubscribe },
          },
        };
      });

      const initialSession: MockSession = {
        user: { id: "user-123", email: "test@example.com" },
        access_token: "token-123",
      };
      mockGetSession.mockResolvedValue({
        data: { session: initialSession },
        error: null,
      });
      mockSingle.mockResolvedValue({
        data: { id: "user-123", username: "testuser", email: "test@example.com" },
        error: null,
      });

      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByTestId("user")).toHaveTextContent("test@example.com");
      });

      // Simulate sign out
      await act(async () => {
        if (authStateCallback) {
          authStateCallback("SIGNED_OUT", null);
        }
      });

      await waitFor(() => {
        expect(screen.getByTestId("user")).toHaveTextContent("no-user");
        expect(screen.getByTestId("profile")).toHaveTextContent("no-profile");
      });
    });
  });

  describe("signUp", () => {
    it("should call supabase signUp with correct parameters", async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
      mockSignUp.mockResolvedValue({
        data: { user: { id: "new-user-id" } },
        error: null,
      });

      let capturedAuth: ReturnType<typeof useAuth> | null = null;
      renderWithProvider(
        <TestConsumer onRender={(auth) => { capturedAuth = auth; }} />
      );

      await waitFor(() => {
        expect(capturedAuth).not.toBeNull();
      });

      await act(async () => {
        await capturedAuth!.signUp("new@example.com", "password123", "newuser");
      });

      expect(mockSignUp).toHaveBeenCalledWith({
        email: "new@example.com",
        password: "password123",
        options: {
          data: {
            username: "newuser",
          },
        },
      });
    });

    it("should create profile in database after successful signup", async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
      mockSignUp.mockResolvedValue({
        data: { user: { id: "created-user-id" } },
        error: null,
      });

      let capturedAuth: ReturnType<typeof useAuth> | null = null;
      renderWithProvider(
        <TestConsumer onRender={(auth) => { capturedAuth = auth; }} />
      );

      await waitFor(() => {
        expect(capturedAuth).not.toBeNull();
      });

      await act(async () => {
        await capturedAuth!.signUp("profile@example.com", "password123", "profileuser");
      });

      expect(mockInsert).toHaveBeenCalledWith({
        id: "created-user-id",
        username: "profileuser",
        email: "profile@example.com",
      });
    });

    it("should return error when signup fails", async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
      const signupError = { message: "User already exists", status: 400 };
      mockSignUp.mockResolvedValue({
        data: { user: null },
        error: signupError,
      });

      let capturedAuth: ReturnType<typeof useAuth> | null = null;
      renderWithProvider(
        <TestConsumer onRender={(auth) => { capturedAuth = auth; }} />
      );

      await waitFor(() => {
        expect(capturedAuth).not.toBeNull();
      });

      let result: { error: unknown };
      await act(async () => {
        result = await capturedAuth!.signUp("existing@example.com", "password123", "existinguser");
      });

      expect(result!.error).toEqual(signupError);
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it("should not create profile when signup returns error", async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
      mockSignUp.mockResolvedValue({
        data: { user: null },
        error: { message: "Signup failed" },
      });

      let capturedAuth: ReturnType<typeof useAuth> | null = null;
      renderWithProvider(
        <TestConsumer onRender={(auth) => { capturedAuth = auth; }} />
      );

      await waitFor(() => {
        expect(capturedAuth).not.toBeNull();
      });

      await act(async () => {
        await capturedAuth!.signUp("test@example.com", "password", "testuser");
      });

      expect(mockInsert).not.toHaveBeenCalled();
    });
  });

  describe("signIn", () => {
    it("should call supabase signInWithPassword with correct parameters", async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
      mockSignInWithPassword.mockResolvedValue({ error: null });

      let capturedAuth: ReturnType<typeof useAuth> | null = null;
      renderWithProvider(
        <TestConsumer onRender={(auth) => { capturedAuth = auth; }} />
      );

      await waitFor(() => {
        expect(capturedAuth).not.toBeNull();
      });

      await act(async () => {
        await capturedAuth!.signIn("user@example.com", "mypassword");
      });

      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "mypassword",
      });
    });

    it("should return null error on successful sign in", async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
      mockSignInWithPassword.mockResolvedValue({ error: null });

      let capturedAuth: ReturnType<typeof useAuth> | null = null;
      renderWithProvider(
        <TestConsumer onRender={(auth) => { capturedAuth = auth; }} />
      );

      await waitFor(() => {
        expect(capturedAuth).not.toBeNull();
      });

      let result: { error: unknown };
      await act(async () => {
        result = await capturedAuth!.signIn("user@example.com", "password");
      });

      expect(result!.error).toBeNull();
    });

    it("should return error on failed sign in", async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
      const signInError = { message: "Invalid credentials", status: 401 };
      mockSignInWithPassword.mockResolvedValue({ error: signInError });

      let capturedAuth: ReturnType<typeof useAuth> | null = null;
      renderWithProvider(
        <TestConsumer onRender={(auth) => { capturedAuth = auth; }} />
      );

      await waitFor(() => {
        expect(capturedAuth).not.toBeNull();
      });

      let result: { error: unknown };
      await act(async () => {
        result = await capturedAuth!.signIn("wrong@example.com", "wrongpassword");
      });

      expect(result!.error).toEqual(signInError);
    });
  });

  describe("signOut", () => {
    it("should call supabase signOut", async () => {
      const mockSession: MockSession = {
        user: { id: "user-123", email: "test@example.com" },
        access_token: "token-123",
      };
      mockGetSession.mockResolvedValue({ data: { session: mockSession }, error: null });
      mockSignOut.mockResolvedValue({ error: null });
      mockSingle.mockResolvedValue({
        data: { id: "user-123", username: "testuser", email: "test@example.com" },
        error: null,
      });

      let capturedAuth: ReturnType<typeof useAuth> | null = null;
      renderWithProvider(
        <TestConsumer onRender={(auth) => { capturedAuth = auth; }} />
      );

      await waitFor(() => {
        expect(capturedAuth).not.toBeNull();
      });

      await act(async () => {
        await capturedAuth!.signOut();
      });

      expect(mockSignOut).toHaveBeenCalled();
    });

    it("should clear profile after sign out", async () => {
      const mockSession: MockSession = {
        user: { id: "user-123", email: "test@example.com" },
        access_token: "token-123",
      };
      mockGetSession.mockResolvedValue({ data: { session: mockSession }, error: null });
      mockSignOut.mockResolvedValue({ error: null });
      mockSingle.mockResolvedValue({
        data: { id: "user-123", username: "testuser", email: "test@example.com" },
        error: null,
      });

      let capturedAuth: ReturnType<typeof useAuth> | null = null;
      renderWithProvider(
        <TestConsumer onRender={(auth) => { capturedAuth = auth; }} />
      );

      await waitFor(() => {
        expect(screen.getByTestId("profile")).toHaveTextContent("testuser");
      });

      await act(async () => {
        await capturedAuth!.signOut();
      });

      // Note: The profile is cleared synchronously in signOut
      // The user/session will be cleared by onAuthStateChange
      expect(screen.getByTestId("profile")).toHaveTextContent("no-profile");
    });
  });

  describe("resetPassword", () => {
    it("should call resetPasswordForEmail with correct parameters", async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
      mockResetPasswordForEmail.mockResolvedValue({ error: null });

      let capturedAuth: ReturnType<typeof useAuth> | null = null;
      renderWithProvider(
        <TestConsumer onRender={(auth) => { capturedAuth = auth; }} />
      );

      await waitFor(() => {
        expect(capturedAuth).not.toBeNull();
      });

      await act(async () => {
        await capturedAuth!.resetPassword("reset@example.com");
      });

      expect(mockResetPasswordForEmail).toHaveBeenCalledWith(
        "reset@example.com",
        { redirectTo: "http://localhost:3000/auth/reset-password" }
      );
    });

    it("should return null error on success", async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
      mockResetPasswordForEmail.mockResolvedValue({ error: null });

      let capturedAuth: ReturnType<typeof useAuth> | null = null;
      renderWithProvider(
        <TestConsumer onRender={(auth) => { capturedAuth = auth; }} />
      );

      await waitFor(() => {
        expect(capturedAuth).not.toBeNull();
      });

      let result: { error: unknown };
      await act(async () => {
        result = await capturedAuth!.resetPassword("test@example.com");
      });

      expect(result!.error).toBeNull();
    });

    it("should return error when reset fails", async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
      const resetError = { message: "User not found", status: 404 };
      mockResetPasswordForEmail.mockResolvedValue({ error: resetError });

      let capturedAuth: ReturnType<typeof useAuth> | null = null;
      renderWithProvider(
        <TestConsumer onRender={(auth) => { capturedAuth = auth; }} />
      );

      await waitFor(() => {
        expect(capturedAuth).not.toBeNull();
      });

      let result: { error: unknown };
      await act(async () => {
        result = await capturedAuth!.resetPassword("unknown@example.com");
      });

      expect(result!.error).toEqual(resetError);
    });
  });

  describe("updatePassword", () => {
    it("should call updateUser with new password", async () => {
      const mockSession: MockSession = {
        user: { id: "user-123", email: "test@example.com" },
        access_token: "token-123",
      };
      mockGetSession.mockResolvedValue({ data: { session: mockSession }, error: null });
      mockUpdateUser.mockResolvedValue({ error: null });
      mockSingle.mockResolvedValue({
        data: { id: "user-123", username: "testuser", email: "test@example.com" },
        error: null,
      });

      let capturedAuth: ReturnType<typeof useAuth> | null = null;
      renderWithProvider(
        <TestConsumer onRender={(auth) => { capturedAuth = auth; }} />
      );

      await waitFor(() => {
        expect(capturedAuth).not.toBeNull();
      });

      await act(async () => {
        await capturedAuth!.updatePassword("newSecurePassword123");
      });

      expect(mockUpdateUser).toHaveBeenCalledWith({
        password: "newSecurePassword123",
      });
    });

    it("should return null error on success", async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
      mockUpdateUser.mockResolvedValue({ error: null });

      let capturedAuth: ReturnType<typeof useAuth> | null = null;
      renderWithProvider(
        <TestConsumer onRender={(auth) => { capturedAuth = auth; }} />
      );

      await waitFor(() => {
        expect(capturedAuth).not.toBeNull();
      });

      let result: { error: unknown };
      await act(async () => {
        result = await capturedAuth!.updatePassword("newPassword");
      });

      expect(result!.error).toBeNull();
    });

    it("should return error when update fails", async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
      const updateError = { message: "Password too weak", status: 400 };
      mockUpdateUser.mockResolvedValue({ error: updateError });

      let capturedAuth: ReturnType<typeof useAuth> | null = null;
      renderWithProvider(
        <TestConsumer onRender={(auth) => { capturedAuth = auth; }} />
      );

      await waitFor(() => {
        expect(capturedAuth).not.toBeNull();
      });

      let result: { error: unknown };
      await act(async () => {
        result = await capturedAuth!.updatePassword("weak");
      });

      expect(result!.error).toEqual(updateError);
    });
  });

  describe("fetchProfile", () => {
    it("should not set profile when fetch returns error", async () => {
      const mockSession: MockSession = {
        user: { id: "user-123", email: "test@example.com" },
        access_token: "token-123",
      };
      mockGetSession.mockResolvedValue({ data: { session: mockSession }, error: null });
      mockSingle.mockResolvedValue({
        data: null,
        error: { message: "Profile not found" },
      });

      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByTestId("loading")).toHaveTextContent("false");
      });

      expect(screen.getByTestId("profile")).toHaveTextContent("no-profile");
    });

    it("should set profile when fetch succeeds", async () => {
      const mockSession: MockSession = {
        user: { id: "user-123", email: "test@example.com" },
        access_token: "token-123",
      };
      mockGetSession.mockResolvedValue({ data: { session: mockSession }, error: null });
      mockSingle.mockResolvedValue({
        data: { id: "user-123", username: "fetcheduser", email: "test@example.com" },
        error: null,
      });

      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByTestId("profile")).toHaveTextContent("fetcheduser");
      });
    });
  });

  describe("useAuth hook", () => {
    it("should throw error when used outside AuthProvider", () => {
      // Suppress console.error for this test
      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      expect(() => {
        render(<TestConsumer />);
      }).toThrow("useAuth must be used within an AuthProvider");

      consoleSpy.mockRestore();
    });

    it("should return all auth context properties", async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

      let capturedAuth: ReturnType<typeof useAuth> | null = null;
      renderWithProvider(
        <TestConsumer onRender={(auth) => { capturedAuth = auth; }} />
      );

      await waitFor(() => {
        expect(capturedAuth).not.toBeNull();
      });

      // Check all properties are present
      expect(capturedAuth).toHaveProperty("user");
      expect(capturedAuth).toHaveProperty("profile");
      expect(capturedAuth).toHaveProperty("session");
      expect(capturedAuth).toHaveProperty("loading");
      expect(capturedAuth).toHaveProperty("signUp");
      expect(capturedAuth).toHaveProperty("signIn");
      expect(capturedAuth).toHaveProperty("signOut");
      expect(capturedAuth).toHaveProperty("resetPassword");
      expect(capturedAuth).toHaveProperty("updatePassword");

      // Check methods are functions
      expect(typeof capturedAuth!.signUp).toBe("function");
      expect(typeof capturedAuth!.signIn).toBe("function");
      expect(typeof capturedAuth!.signOut).toBe("function");
      expect(typeof capturedAuth!.resetPassword).toBe("function");
      expect(typeof capturedAuth!.updatePassword).toBe("function");
    });
  });

  describe("edge cases", () => {
    it("should handle null user in session gracefully", async () => {
      mockGetSession.mockResolvedValue({
        data: { session: { user: null, access_token: "token" } },
        error: null,
      });

      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByTestId("loading")).toHaveTextContent("false");
      });

      expect(screen.getByTestId("user")).toHaveTextContent("no-user");
    });

    it("should handle empty profile data", async () => {
      const mockSession: MockSession = {
        user: { id: "user-123", email: "test@example.com" },
        access_token: "token-123",
      };
      mockGetSession.mockResolvedValue({ data: { session: mockSession }, error: null });
      mockSingle.mockResolvedValue({
        data: { id: "user-123", username: null, email: null },
        error: null,
      });

      renderWithProvider();

      await waitFor(() => {
        expect(screen.getByTestId("profile")).toHaveTextContent("no-profile");
      });
    });

    it("should handle concurrent auth operations", async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
      mockSignInWithPassword.mockResolvedValue({ error: null });

      let capturedAuth: ReturnType<typeof useAuth> | null = null;
      renderWithProvider(
        <TestConsumer onRender={(auth) => { capturedAuth = auth; }} />
      );

      await waitFor(() => {
        expect(capturedAuth).not.toBeNull();
      });

      // Fire multiple operations concurrently
      await act(async () => {
        await Promise.all([
          capturedAuth!.signIn("user1@test.com", "pass1"),
          capturedAuth!.signIn("user2@test.com", "pass2"),
        ]);
      });

      expect(mockSignInWithPassword).toHaveBeenCalledTimes(2);
    });
  });
});
