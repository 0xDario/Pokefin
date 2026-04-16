"use client";

import { useState, useCallback } from "react";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../../context/AuthContext";
import { BoxRecipe, PackEntry } from "../types";

function generateShareCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function toDbPacks(packs: PackEntry[]): { set_id: number; quantity: number }[] {
  return packs.map((p) => ({ set_id: p.setId, quantity: p.quantity }));
}

function fromDbPacks(
  dbPacks: { set_id: number; quantity: number }[],
  setNameMap: Map<number, string>
): PackEntry[] {
  return dbPacks.map((p) => ({
    id: crypto.randomUUID(),
    setId: p.set_id,
    setName: setNameMap.get(p.set_id) || `Set #${p.set_id}`,
    quantity: p.quantity,
  }));
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
      console.error("[useBoxRecipes] Load error:", error);
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

      const shareCode = recipe.shareCode || generateShareCode();

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
            updated_at: new Date().toISOString(),
          })
          .eq("id", recipe.id)
          .eq("user_id", user.id)
          .select()
          .single();

        if (error) {
          console.error("[useBoxRecipes] Update error:", error);
          return null;
        }

        const updated: BoxRecipe = {
          ...recipe,
          shareCode: data.share_code,
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
          })
          .select()
          .single();

        if (error) {
          console.error("[useBoxRecipes] Insert error:", error);
          return null;
        }

        const saved: BoxRecipe = {
          ...recipe,
          id: data.id,
          shareCode: data.share_code,
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
        console.error("[useBoxRecipes] Delete error:", error);
        return;
      }

      setSavedRecipes((prev) => prev.filter((r) => r.id !== recipeId));
    },
    [user]
  );

  const loadSharedRecipe = useCallback(
    async (shareCode: string): Promise<BoxRecipe | null> => {
      const { data, error } = await supabase
        .from("box_recipes")
        .select("*")
        .eq("share_code", shareCode)
        .single();

      if (error || !data) {
        console.error("[useBoxRecipes] Share load error:", error);
        return null;
      }

      return {
        id: data.id,
        name: data.name,
        retailPrice: data.retail_price,
        promoValue: data.promo_value,
        packs: fromDbPacks(data.packs || [], setNameMap),
        shareCode: data.share_code,
        userId: data.user_id,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
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
