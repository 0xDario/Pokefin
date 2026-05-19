"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";

export default function AccountPage() {
  const { user, profile, loading, updatePassword, signOut } = useAuth();
  const router = useRouter();

  // Username update
  const [username, setUsername] = useState("");
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [usernameSuccess, setUsernameSuccess] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);

  // Password update
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Account deletion
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.username) {
      setUsername(profile.username);
    }
  }, [profile]);

  // Redirect if not logged in
  useEffect(() => {
    if (!loading && !user) {
      router.push("/auth/login");
    }
  }, [loading, user, router]);

  const handleUsernameUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setUsernameError(null);
    setUsernameSuccess(false);

    if (username.length < 3) {
      setUsernameError("Username must be at least 3 characters long");
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setUsernameError(
        "Username can only contain letters, numbers, and underscores"
      );
      return;
    }

    setUsernameLoading(true);

    const { error } = await supabase
      .from("profiles")
      .update({ username })
      .eq("id", user!.id);

    if (error) {
      if (error.code === "23505") {
        setUsernameError("This username is already taken");
      } else {
        setUsernameError(error.message);
      }
    } else {
      setUsernameSuccess(true);
      setTimeout(() => setUsernameSuccess(false), 3000);
    }

    setUsernameLoading(false);
  };

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);

    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError("Password must be at least 8 characters long");
      return;
    }

    setPasswordLoading(true);

    const { error } = await updatePassword(newPassword);

    if (error) {
      setPasswordError(error.message);
    } else {
      setPasswordSuccess(true);
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setPasswordSuccess(false), 3000);
    }

    setPasswordLoading(false);
  };

  const handleDeleteAccount = async () => {
    const confirmed = window.confirm(
      "Are you sure you want to delete your account? This action cannot be undone."
    );

    if (!confirmed) return;

    setDeleteLoading(true);
    setDeleteError(null);

    try {
      const response = await fetch("/api/account/delete", {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to delete account");
      }

      await signOut();
      router.push("/");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete account");
      setDeleteLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--pf-pokeball)]"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-600">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[var(--pf-pokeball)]"></div>
          <span>Redirecting to login…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6 md:mb-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--pf-pokeball)]">
            Pokéfin
          </p>
          <h1 className="mt-1 text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">
            Account Settings
          </h1>
        </div>

        {/* Profile Section */}
        <div className="bg-white rounded-xl ring-1 ring-slate-200 shadow-sm p-6 mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-4">
            Profile
          </h2>

          <div className="mb-4">
            <p className="text-sm text-slate-500">Email</p>
            <p className="text-slate-900">{user.email}</p>
          </div>

          <form onSubmit={handleUsernameUpdate} className="space-y-4">
            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium mb-1"
              >
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:border-transparent bg-white"
              />
              <p className="text-xs text-slate-500 mt-1">
                Letters, numbers, and underscores only
              </p>
            </div>

            {usernameError && (
              <div className="text-rose-600 text-sm">
                {usernameError}
              </div>
            )}

            {usernameSuccess && (
              <div className="text-emerald-600 text-sm">
                Username updated successfully!
              </div>
            )}

            <button
              type="submit"
              disabled={usernameLoading}
              className="bg-[var(--pf-pokeball)] hover:bg-[var(--pf-pokeball-strong)] text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50"
            >
              {usernameLoading ? "Saving..." : "Update Username"}
            </button>
          </form>
        </div>

        {/* Password Section */}
        <div className="bg-white rounded-xl ring-1 ring-slate-200 shadow-sm p-6 mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-4">
            Change Password
          </h2>

          <form onSubmit={handlePasswordUpdate} className="space-y-4">
            <div>
              <label
                htmlFor="newPassword"
                className="block text-sm font-medium mb-1"
              >
                New Password
              </label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:border-transparent bg-white"
                placeholder="••••••••"
              />
              <p className="text-xs text-slate-500 mt-1">At least 8 characters</p>
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium mb-1"
              >
                Confirm New Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:border-transparent bg-white"
                placeholder="••••••••"
              />
            </div>

            {passwordError && (
              <div className="text-rose-600 text-sm">
                {passwordError}
              </div>
            )}

            {passwordSuccess && (
              <div className="text-emerald-600 text-sm">
                Password updated successfully!
              </div>
            )}

            <button
              type="submit"
              disabled={passwordLoading}
              className="bg-[var(--pf-pokeball)] hover:bg-[var(--pf-pokeball-strong)] text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50"
            >
              {passwordLoading ? "Updating..." : "Update Password"}
            </button>
          </form>
        </div>

        {/* Danger Zone */}
        <div className="bg-white rounded-xl shadow-sm ring-1 ring-rose-200 p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-rose-600 mb-4">
            Danger Zone
          </h2>
          <p className="text-sm text-slate-600 mb-4">
            Permanently delete your account and all associated data. This action
            cannot be undone.
          </p>
          {deleteError && (
            <div className="text-rose-600 text-sm mb-4">
              {deleteError}
            </div>
          )}
          <button
            onClick={handleDeleteAccount}
            disabled={deleteLoading}
            className="bg-rose-600 hover:bg-rose-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50"
          >
            {deleteLoading ? "Deleting..." : "Delete Account"}
          </button>
        </div>
      </div>
    </div>
  );
}
