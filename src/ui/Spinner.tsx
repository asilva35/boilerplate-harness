// Equivalent to internal/ui/spinner.go, with the same braille frames. In
// Go the spinner writes \r by hand over stdout; in Ink that's not needed —
// we just re-render the frame like any other piece of React state.

import { useEffect, useState } from "react";
import { Text } from "ink";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Spinner({ label }: { label: string }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 80);
    return () => clearInterval(id);
  }, []);

  return (
    <Text>
      <Text color="cyan">{FRAMES[frame]}</Text> <Text dimColor>{label}</Text>
    </Text>
  );
}
