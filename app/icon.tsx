import { ImageResponse } from "next/og";
import { BrandMarkIcon } from "@/lib/brand-mark";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<BrandMarkIcon size={64} />, size);
}
