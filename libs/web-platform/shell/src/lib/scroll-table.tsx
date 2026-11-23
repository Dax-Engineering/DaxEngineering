import { Table, type TableProps } from '@mantine/core';

/** A table that scrolls sideways inside its card when it is wider than the card. */
export function ScrollTable(props: TableProps) {
  return (
    <div className="dax-table-scroll">
      <Table {...props} />
    </div>
  );
}
