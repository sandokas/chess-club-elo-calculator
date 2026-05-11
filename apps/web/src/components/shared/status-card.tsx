import { Card, CardContent } from "@/components/ui/card.js";
import { Badge } from "@/components/ui/badge.js";
import { Loader2, AlertCircle } from "lucide-react";

interface StatusCardProps {
  title: string;
  message: string;
  tone: "loading" | "error";
}

export function StatusCard({ title, message, tone }: StatusCardProps) {
  return (
    <section className="flex flex-col items-center justify-center min-h-[50vh]" aria-labelledby="status-title">
      <p className="text-sm font-semibold text-primary mb-2 uppercase tracking-wider">Chess Club Manager</p>
      <h1 id="status-title" className="text-3xl font-bold mb-6">{title}</h1>
      <Card className="w-full max-w-md">
        <CardContent className="flex items-center gap-4 p-6">
          {tone === "loading" ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : (
            <AlertCircle className="h-5 w-5 text-destructive" />
          )}
          <p className="text-sm">{message}</p>
        </CardContent>
      </Card>
    </section>
  );
}
