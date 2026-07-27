import { describe, expect, it } from 'vitest';
import {
  collectFunctionDefinitions,
  getEffectiveFunctionBody,
  resolveEffectiveFunctionChain,
} from './sql-function-resolution.mjs';

describe('SQL function resolution', () => {
  it('uses the latest definition in migration order', () => {
    const sql = `
      create function public.cancel_ride(p_ride_id uuid)
      returns jsonb language plpgsql as $$ begin return '{"version":1}'::jsonb; end $$;

      create or replace function public.cancel_ride(p_ride_id uuid)
      returns jsonb language plpgsql as $$ begin return '{"version":2}'::jsonb; end $$;
    `;

    const definitions = collectFunctionDefinitions(sql);
    const body = getEffectiveFunctionBody(definitions, 'cancel_ride');

    expect(body).toContain('"version":2');
    expect(body).not.toContain('"version":1');
  });

  it('follows an effective wrapper into its delegated implementation', () => {
    const sql = `
      create function public.cancel_ride_unified(p_ride_id uuid)
      returns jsonb language plpgsql as $$
      begin
        perform auth.uid();
        select * from rides where id = p_ride_id for update;
        update rides set status = 'cancelled';
        return jsonb_build_object('refund', true, 'wallet', true);
      end $$;

      create or replace function public.cancel_ride(p_ride_id uuid)
      returns jsonb language sql as $$
        select public.cancel_ride_unified(p_ride_id);
      $$;
    `;

    const definitions = collectFunctionDefinitions(sql);
    const chain = resolveEffectiveFunctionChain(definitions, 'cancel_ride');

    expect(chain).toContain('cancel_ride_unified');
    expect(chain).toContain('for update');
    expect(chain).toContain("status = 'cancelled'");
    expect(chain).toContain("'refund'");
  });

  it('does not recurse forever when functions reference each other', () => {
    const sql = `
      create function public.cancel_ride(p_ride_id uuid)
      returns jsonb language sql as $$ select public.cancel_ride_unified(p_ride_id) $$;

      create function public.cancel_ride_unified(p_ride_id uuid)
      returns jsonb language sql as $$ select public.cancel_ride(p_ride_id) $$;
    `;

    const definitions = collectFunctionDefinitions(sql);
    const chain = resolveEffectiveFunctionChain(definitions, 'cancel_ride');

    expect(chain.match(/create function/g)).toHaveLength(2);
  });
});
