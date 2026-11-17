import type { APIRoute } from 'astro';
import { decodeModelToken } from '../../../../lib/ai-pure';
import { ApiError, handle, json, parseJson } from '../../../../lib/api';
import { addAiVote } from '../../../../lib/db';
import { aiVoteSchema } from '../../../../lib/schemas';

export const prerender = false;

/** Record which of two unlabeled sets the owner chose in a blind comparison. */
export const POST: APIRoute = ({ request }) =>
  handle(async () => {
    const input = await parseJson(request, aiVoteSchema);
    const winner = decodeModelToken(input.winner);
    const loser = decodeModelToken(input.loser);
    if (!winner || !loser || winner === loser) throw new ApiError(400, 'invalid', 'Unrecognised comparison.');
    await addAiVote(winner, loser);
    return json({ ok: true }, 201);
  });
