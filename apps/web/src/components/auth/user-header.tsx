import React from "react";
import { useAuth } from "../../contexts/auth-context.js";
import { Button } from "../ui/button.js";

export function UserHeader() {
  const { user, logout } = useAuth();

  if (!user) {
    return null;
  }

  return (
    <div className="flex items-center gap-4 border-b bg-white px-4 py-2">
      <div className="flex items-center gap-2">
        {user.avatarUrl && (
          <img
            src={user.avatarUrl}
            alt={user.name}
            className="h-8 w-8 rounded-full"
          />
        )}
        <span className="text-sm font-medium">{user.name}</span>
      </div>
      <Button onClick={logout} variant="outline" size="sm">
        Sign out
      </Button>
    </div>
  );
}
