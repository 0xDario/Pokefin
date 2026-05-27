"use client";

import { useState, useCallback } from "react";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../../context/AuthContext";
import { BoxRecipe, PackEntry } from "../types";

function generateShareCode(): string {
  // 16 bytes = 128 bits of entropy. crypto.getRandomValues is a CSPRNG,
  // unlike Math.random which is predictable.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function toDbPacks(packs: PackEntry[]): { set_id: number; quantity: number }[] {
  return packs.map((p) => ({ set_id: p.setId, quantity: p.quantity }));
}

function fromDbPacks(
  dbPacks: unknown,
  setNameMap: Map<number, string>
): PackEntry[] {
  // Defense-in-depth: a malformed JSONB row (or a freshly shared
  // recipe whose schema drifted) must not crash the UI. We accept
  // only entries with { set_id: positive int, quantity: 1-100000 }
  // and silently drop anything else.
  if (!Array.isArray(dbPacks)) return [];
  const out: PackEntry[] = [];
  for (const raw of dbPacks) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as { set_id?: unknown; quantity?: unknown };
    if (
      typeof p.set_id !== "number" ||
      !Number.isInteger(p.set_id) ||
      p.set_id <= 0
    ) continue;
    if (
      typeof p.quantity !== "number" ||
      !Number.isInteger(p.quantity) ||
      p.quantity < 1 ||
      p.quantity > 100_000
    ) continue;
    out.push({
      id: crypto.randomUUID(),
      setId: p.set_id,
      setName: setNameMap.get(p.set_id) || `Set #${p.set_id}`,
      quantity: p.quantity,
    });
    if (out.length >= 50) break;
  }
  return out;
}

export function useBoxRecipes(setNameMap: Map<number, string>) {
  const { user } = useAuth();
  const [savedRecipes, setSavedRecipes] = useState<BoxRecipe[]>([]);
  const [recipesLoading, setRecipesLoading] = useState(false);

  const loadMyRecipes = useCallback(async () => {
    if (!user) return;
    setRecipesLoading(true);

    const { data, error } = await supabase
      .from("box_recipes")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("recipes_load_failed", { code: error.code });
      setRecipesLoading(false);
      return;
    }

    if (data) {
      setSavedRecipes(
        data.map((r: any) => ({
          id: r.id,
          name: r.name,
          retailPrice: r.retail_price,
          promoValue: r.promo_value,
          packs: fromDbPacks(r.packs || [], setNameMap),
          shareCode: r.share_code,
          isPublic: r.is_public,
          userId: r.user_id,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        }))
      );
    }

    setRecipesLoading(false);
  }, [user, setNameMap]);

  const saveRecipe = useCallback(
    async (recipe: BoxRecipe): Promise<BoxRecipe | null> => {
      if (!user) return null;

      // Only generate / persist a share code when the user explicitly
      // makes the recipe public. Never auto-share on save.
      const isPublic = recipe.isPublic === true;
      const shareCode = isPublic
        ? recipe.shareCode || generateShareCode()
        : null;

      if (recipe.id) {
        // Update existing
        const { data, error } = await supabase
          .from("box_recipes")
          .update({
            name: recipe.name,
            retail_price: recipe.retailPrice,
            promo_value: recipe.promoValue,
            packs: toDbPacks(recipe.packs),
            share_code: shareCode,
            is_public: isPublic,
            updated_at: new Date().toISOString(),
          })
          .eq("id", recipe.id)
          .eq("user_id", user.id)
          .select()
          .single();

        if (error) {
          console.error("recipe_update_failed", { code: error.code });
          return null;
        }

        const updated: BoxRecipe = {
          ...recipe,
          shareCode: data.share_code,
          isPublic: data.is_public,
          updatedAt: data.updated_at,
        };

        setSavedRecipes((prev) =>
          prev.map((r) => (r.id === recipe.id ? updated : r))
        );

        return updated;
      } else {
        // Insert new
        const { data, error } = await supabase
          .from("box_recipes")
          .insert({
            user_id: user.id,
            name: recipe.name,
            retail_price: recipe.retailPrice,
            promo_value: recipe.promoValue,
            packs: toDbPacks(recipe.packs),
            share_code: shareCode,
            is_public: isPublic,
          })
          .select()
          .single();

        if (error) {
          console.error("recipe_insert_failed", { code: error.code });
          return null;
        }

        const saved: BoxRecipe = {
          ...recipe,
          id: data.id,
          shareCode: data.share_code,
          isPublic: data.is_public,
          userId: data.user_id,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        };

        setSavedRecipes((prev) => [saved, ...prev]);
        return saved;
      }
    },
    [user]
  );

  const deleteRecipe = useCallback(
    async (recipeId: number) => {
      if (!user) return;

      const { error } = await supabase
        .from("box_recipes")
        .delete()
        .eq("id", recipeId)
        .eq("user_id", user.id);

      if (error) {
        console.error("recipe_delete_failed", { code: error.code });
        return;
      }

      setSavedRecipes((prev) => prev.filter((r) => r.id !== recipeId));
    },
    [user]
  );

  const loadSharedRecipe = useCallback(
    async (shareCode: string): Promise<BoxRecipe | null> => {
      // The get_shared_recipe RPC returns at most one row matched
      // by exact share_code AND is_public=true. The anon role
      // cannot enumerate via PostgREST filters because direct table
      // SELECT for non-owners is denied by RLS.
      const { data, error } = await supabase.rpc("get_shared_recipe", {
        p_share_code: shareCode,
      });

      if (error || !data || data.length === 0) {
        if (error) console.error("shared_recipe_fetch_failed", { code: error.code });
        return null;
      }

      const row = Array.isArray(data) ? data[0] : data;
      return {
        id: row.id,
        name: row.name,
        retailPrice: row.retail_price,
        promoValue: row.promo_value,
        packs: fromDbPacks(row.packs || [], setNameMap),
        shareCode: row.share_code,
        isPublic: row.is_public,
        userId: row.user_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    },
    [setNameMap]
  );

  return {
    savedRecipes,
    recipesLoading,
    loadMyRecipes,
    saveRecipe,
    deleteRecipe,
    loadSharedRecipe,
  };
}
