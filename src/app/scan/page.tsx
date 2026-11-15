"use client";
import * as React from "react";
import { Volume2, VolumeX } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { NetworkIndicator } from "@/components/network-indicator";
import { RequireRole } from "@/components/require-role";
import { ScanStation } from "@/components/scan-station";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNetworkStatus } from "@/hooks/use-network";
import { setSoundEnabled, soundEnabled, unlockAudio } from "@/lib/client/feedback";

const COUNTER_KEY = "swag.counter";

export default function ScanPage() {
  return (
    <RequireRole roles={["volunteer", "organizer"]}>
      <ScanScreen />
    </RequireRole>
  );
}

function ScanScreen() {
  const net = useNetworkStatus();
  const [counter, setCounter] = React.useState("");
  const [editing, setEditing] = React.useState(false);
  const [sound, setSound] = React.useState(true);

  React.useEffect(() => {
    let c = "";
    try {
      c = localStorage.getItem(COUNTER_KEY) ?? "";
    } catch {
      /* ignore */
    }
    setCounter(c);
    setEditing(!c);
    setSound(soundEnabled());
  }, []);

  const saveCounter = (v: string) => {
    const name = v.trim().slice(0, 40);
    if (!name) return;
    setCounter(name);
    setEditing(false);
    try {
      localStorage.setItem(COUNTER_KEY, name);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="min-h-dvh">
      <AppHeader
        sub={counter ? `Swag · ${counter}` : "Swag scanner"}
        right={
            <Button
              variant="ghost"
              size="icon"
              aria-label={sound ? "Mute sounds" : "Enable sounds"}
              onClick={() => {
                unlockAudio();
                setSoundEnabled(!sound);
                setSound(!sound);
              }}
            >
              {sound ? <Volume2 /> : <VolumeX />}
            </Button>
        }
      />
      <main className="mx-auto flex max-w-xl flex-col gap-3 p-3 pb-20 sm:p-4 sm:pb-20">
        {editing ? (
          <form
            className="flex flex-col gap-3 rounded-xl border bg-card p-4"
            onSubmit={(e) => {
              e.preventDefault();
              saveCounter(new FormData(e.currentTarget).get("counter") as string);
            }}
          >
            <label htmlFor="counter" className="text-lg font-semibold">
              Which swag counter are you at?
            </label>
            <div className="flex flex-wrap gap-2">
              {["Counter 1", "Counter 2", "Counter 3", "Help Desk"].map((c) => (
                <Button key={c} type="button" variant="outline" size="lg" onClick={() => saveCounter(c)}>
                  {c}
                </Button>
              ))}
            </div>
            <div className="flex gap-2">
              <Input id="counter" name="counter" defaultValue={counter} placeholder="Or type a name" className="h-12" />
              <Button type="submit" size="lg">
                Save
              </Button>
            </div>
          </form>
        ) : (
          <>
            <ScanStation counter={counter} network={net.state} />
            <button className="text-center text-sm text-muted-foreground underline" onClick={() => setEditing(true)}>
              Change counter ({counter})
            </button>
          </>
        )}
      </main>
      <footer className="fixed inset-x-0 bottom-0 z-40 flex justify-center border-t bg-card/95 px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur">
        <NetworkIndicator state={net.state} latency={net.latency} showLabel />
      </footer>
    </div>
  );
}
