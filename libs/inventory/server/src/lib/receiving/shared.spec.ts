import type { HttpException } from '@nestjs/common';
import { type ItemCheck, requireItem } from './shared';

const archived: ItemCheck = {
  id: 'old',
  partNo: '1R-0750',
  allowFraction: false,
  status: 'ARCHIVED',
};
const items = new Map([[archived.id, archived]]);

function message(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return (error as HttpException).getResponse();
  }
  return undefined;
}

describe('requireItem', () => {
  it('words the archived refusal for each place', () => {
    const refusal = (use: 'receive' | 'issue' | 'bundle') =>
      message(() => requireItem(items, 'old', 'lines.0.itemId', use));
    expect(refusal('receive')).toMatchObject({
      message: "1R-0750 is archived and can't be received.",
    });
    expect(refusal('issue')).toMatchObject({
      message: "1R-0750 is archived and can't be issued.",
    });
    expect(refusal('bundle')).toMatchObject({
      message: "1R-0750 is archived and can't be added to a bundle.",
    });
  });

  it('allows an archived part already on a document', () => {
    expect(requireItem(items, 'old', 'lines.0.itemId', null)).toBe(archived);
  });
});
