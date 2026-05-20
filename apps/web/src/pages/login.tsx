import React from "react";
import { useAuth } from "../contexts/auth-context.js";
import { Button } from "../components/ui/button.js";

export function LoginPage() {
  const { login, isLoading } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md space-y-8 rounded-lg bg-white p-8 shadow-md">
        <div>
          <h2 className="text-center text-3xl font-bold tracking-tight text-gray-900">
            Sign in to Chess Club
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Sign in with your Google account to access your clubs
          </p>
        </div>
        <div>
          <Button
            onClick={login}
            disabled={isLoading}
            className="w-full"
            size="lg"
          >
            {isLoading ? "Signing in..." : "Sign in with Google"}
          </Button>
        </div>
      </div>
    </div>
  );
}
