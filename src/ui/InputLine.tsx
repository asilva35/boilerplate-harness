// Purely presentational: just draws the prompt + value + cursor. All the
// keyboard logic lives in App (see the comment there about why there's a
// single, always-active useInput instead of one per component).

import { Box, Text } from "ink";

interface Props {
  prompt: string;
  value: string;
  active: boolean;
}

export function InputLine({ prompt, value, active }: Props) {
  return (
    <Box>
      <Text color="cyan">{prompt}</Text>
      <Text>{value}</Text>
      {active && <Text color="cyan">▌</Text>}
    </Box>
  );
}
