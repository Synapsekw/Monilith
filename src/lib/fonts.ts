import { Nunito } from "next/font/google";

/**
 * The MONOLITH wordmark face. Shared by the landing hero and the nav brand so
 * the logo type is identical everywhere. Loaded once, build-time. Nunito's
 * rounded terminals give the wordmark a softer, more modern feel than a squared
 * grotesque while keeping it confident at the extra-bold (800) weight.
 */
export const nunito = Nunito({
  subsets: ["latin"],
  weight: ["800"],
  display: "swap",
});
