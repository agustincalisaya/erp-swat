import { Toaster } from "@/components/ui/toast";

export default function PlaceholderLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toaster />
    </>
  );
}