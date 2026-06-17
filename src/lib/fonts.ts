import { Archivo } from "next/font/google";

/**
 * The MONOLITH wordmark face. Shared by the landing hero and the nav brand so
 * the logo type is identical everywhere. Loaded once, build-time.
 */
export const archivo = Archivo({
  subsets: ["latin"],
  weight: ["800"],
  display: "swap",
});
