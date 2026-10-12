import { Link } from '@chakra-ui/react';
import React from 'react';

// A moderator running a live round needs the operating instructions
// without leaving the console — opens in a new tab so the game itself
// stays on screen. The playbook covers hosting, the console's panels,
// judging photos, the full command reference, and the two irreversible
// header actions (Reset Targets, End Game).
const PLAYBOOK_URL = 'https://claude.ai/code/artifact/350e07aa-21ea-4cf3-a53a-10f1cc29d923';

const PlaybookLink = () => (
    <Link
        href={PLAYBOOK_URL}
        isExternal
        color="white"
        fontWeight="medium"
        mr="16px"
        _hover={{ color: 'gray.300' }}
    >
        Playbook
    </Link>
);

export default PlaybookLink;
