"use client";

import { useState } from "react";
import Image from "next/image";

interface ProductImageProps {
  imageUrl?: string | null;
  productName: string;
  className?: string;
}

/**
 * Product image component with loading state and error fallback
 *
 * @param imageUrl - URL of the product image
 * @param productName - Name of the product (used for alt text)
 * @param className - Additional CSS classes for the container
 */
export default function ProductImage({
  imageUrl,
  productName,
  className = "",
}: ProductImageProps) {
  const [imageError, setImageError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const handleImageLoad = () => {
    setIsLoading(false);
  };

  const handleImageError = () => {
    setImageError(true);
    setIsLoading(false);
  };

  // Fallback UI when no image or error
  if (!imageUrl || imageError) {
    return (
      <div
        className={`bg-slate-200 border-2 border-dashed border-slate-300 flex items-center justify-center ${className}`}
      >
        <div className="text-center text-slate-500 p-4">
          <div className="text-2xl mb-2">🃏</div>
          <div className="text-xs font-medium">No Image</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden bg-white ${className}`}>
      {isLoading && (
        <div className="absolute inset-0 bg-slate-200 animate-pulse flex items-center justify-center">
          <div className="text-slate-400">Loading...</div>
        </div>
      )}
      <div className="w-full h-full flex items-center justify-center p-4">
        <Image
          src={imageUrl}
          alt={productName}
          width={200}
          height={200}
          className={`max-w-full max-h-full object-contain transition-opacity ${
            isLoading ? "opacity-0" : "opacity-100"
          }`}
          onLoad={handleImageLoad}
          onError={handleImageError}
          loading="lazy"
          unoptimized={
            imageUrl.includes("tcgplayer") || imageUrl.includes("external")
          }
        />
      </div>
    </div>
  );
}
