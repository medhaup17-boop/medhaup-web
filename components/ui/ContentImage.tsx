import Image, { type ImageProps } from "next/image";

/** R2 images are resized at upload time and delivered directly by Cloudflare. */
export default function ContentImage(props: ImageProps) {
  let direct = false;
  const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  if (base && typeof props.src === "string") {
    try {
      const asset = new URL(props.src);
      const publicBase = new URL(base);
      const prefix = `${publicBase.pathname.replace(/\/$/, "")}/`;
      direct = asset.origin === publicBase.origin && asset.pathname.startsWith(prefix);
    } catch {
      // Local images and other remote providers retain the normal Next.js loader.
    }
  }
  return <Image {...props} alt={props.alt} unoptimized={props.unoptimized ?? direct} />;
}
