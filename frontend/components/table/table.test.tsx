import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import {
  ColumnsMenu,
  CopyButton,
  ExportButton,
  FullscreenTable,
  PlainHeaderCell,
  SortableHeaderCell,
  TableFilters,
} from '@/components/table';
import { useTableFilters, type TableFilterField } from '@/hooks/useTableFilters';
import { useTableSort } from '@/hooks/useTableSort';
import type { SortAccessors } from '@/lib/tableUtils';

interface Row {
  name: string;
  team: string;
}

const ROWS: Row[] = [
  { name: "Beta", team: "Delivery" },
  { name: "Alpha", team: "Finance" },
];

const ACCESSORS: SortAccessors<Row> = {
  name: (row) => row.name,
  team: (row) => row.team,
};

const FIELDS: readonly TableFilterField<Row>[] = [{ key: 'team', accessor: ACCESSORS.team }];

function SortableHarness() {
  const { sortKey, sortDir, sortedRows, toggleSort } = useTableSort(ROWS, ACCESSORS);
  const { filteredRows, search, setSearch } = useTableFilters(sortedRows, FIELDS);
  const rows = search ? filteredRows : sortedRows;

  return (
    <table>
      <thead>
        <tr>
          <SortableHeaderCell columnKey="name" label="Name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
          <PlainHeaderCell>Action</PlainHeaderCell>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.name}>
            <td>{row.name}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FiltersHarness() {
  const [rows] = useState(ROWS);
  const { search, setSearch, getFilter, setFilter, optionsFor, clearFilters, hasActiveFilters } = useTableFilters(
    rows,
    FIELDS
  );

  return (
    <TableFilters
      search={{ value: search, onChange: setSearch, placeholder: 'Search people' }}
      selects={[
        {
          key: 'team',
          label: 'Team',
          value: getFilter('team'),
          onChange: (value) => setFilter('team', value),
          options: optionsFor('team'),
          allLabel: 'All teams',
        },
      ]}
      onClear={clearFilters}
      hasActiveFilters={hasActiveFilters}
    />
  );
}

describe('SortableHeaderCell', () => {
  it('reports the unsorted state to assistive tech', () => {
    render(
      <table>
        <thead>
          <tr>
            <SortableHeaderCell columnKey="name" label="Name" sortKey={null} sortDir={null} onSort={() => {}} />
          </tr>
        </thead>
      </table>
    );
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'none');
  });

  it('reports the active direction and asks to sort through the header', async () => {
    const onSort = vi.fn();
    render(
      <table>
        <thead>
          <tr>
            <SortableHeaderCell columnKey="name" label="Name" sortKey="name" sortDir="desc" onSort={onSort} />
          </tr>
        </thead>
      </table>
    );
    const header = screen.getByRole('columnheader');
    expect(header).toHaveAttribute('aria-sort', 'descending');

    await userEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(onSort).toHaveBeenCalledWith('name');
  });
});

describe('useTableSort', () => {
  it('cycles a column through ascending, descending and unsorted', async () => {
    render(<SortableHarness />);
    const header = screen.getByRole('button', { name: /Name/ });
    const nameHeader = () => screen.getAllByRole('columnheader')[0];
    const names = () => screen.getAllByRole('row').slice(1).map((row) => row.textContent);

    expect(names()).toEqual(['Beta', 'Alpha']);

    await userEvent.click(header);
    expect(names()).toEqual(['Alpha', 'Beta']);
    expect(nameHeader()).toHaveAttribute('aria-sort', 'ascending');

    await userEvent.click(header);
    expect(names()).toEqual(['Beta', 'Alpha']);
    expect(nameHeader()).toHaveAttribute('aria-sort', 'descending');

    await userEvent.click(header);
    expect(nameHeader()).toHaveAttribute('aria-sort', 'none');
  });

  it('starts newest/biggest first for columns listed in descFirstKeys', async () => {
    function Harness() {
      const { sortKey, sortDir, sortedRows, toggleSort } = useTableSort(ROWS, ACCESSORS, {
        descFirstKeys: ['name'],
      });
      return (
        <table>
          <thead>
            <tr>
              <SortableHeaderCell columnKey="name" label="Name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: /Name/ }));

    // The descending indicator must match the descending row order.
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getAllByRole('row').slice(1).map((row) => row.textContent)).toEqual(['Beta', 'Alpha']);
  });

  it('changes sortVersion on every sort change so pagination can reset', async () => {
    const states: string[] = [];

    function Harness() {
      const { sortKey, sortDir, sortVersion, toggleSort } = useTableSort(ROWS, ACCESSORS);
      states.push(`${sortKey}:${sortDir}`);
      return (
        <>
          <button type="button" onClick={() => toggleSort('name')}>
            toggle
          </button>
          <span data-testid="version">{sortVersion}</span>
        </>
      );
    }

    const { rerender } = render(<Harness />);
    const version = () => Number(screen.getByTestId('version').textContent);

    const v0 = version();

    await userEvent.click(screen.getByRole('button'));
    const v1 = version();
    expect(v1).not.toBe(v0);

    await userEvent.click(screen.getByRole('button'));
    const v2 = version();
    expect(v2).not.toBe(v1);

    await userEvent.click(screen.getByRole('button'));
    const v3 = version();
    expect(v3).not.toBe(v2);

    // unsorted -> asc -> desc -> unsorted
    expect(states).toEqual(['null:null', 'name:asc', 'name:desc', 'null:null']);
    rerender(<Harness />);
  });

  it('changes sortVersion when a different column is sorted the same way', async () => {
    function Harness() {
      const { sortKey, sortDir, sortVersion, toggleSort } = useTableSort(ROWS, ACCESSORS);
      return (
        <>
          <button type="button" onClick={() => toggleSort('name')}>
            name
          </button>
          <button type="button" onClick={() => toggleSort('team')}>
            team
          </button>
          <span data-testid="sort">{`${sortKey}:${sortDir}`}</span>
          <span data-testid="version">{sortVersion}</span>
        </>
      );
    }

    render(<Harness />);
    const version = () => Number(screen.getByTestId('version').textContent);
    const sort = () => screen.getByTestId('sort').textContent;

    // Both columns default to ascending, so the direction alone cannot tell
    // these two sorts apart even though the row order is completely different.
    await userEvent.click(screen.getByRole('button', { name: 'name' }));
    expect(sort()).toBe('name:asc');
    const afterName = version();

    await userEvent.click(screen.getByRole('button', { name: 'team' }));
    expect(sort()).toBe('team:asc');
    expect(version()).not.toBe(afterName);

    // ...and back again, which is the same trap in reverse.
    const afterTeam = version();
    await userEvent.click(screen.getByRole('button', { name: 'name' }));
    expect(version()).not.toBe(afterTeam);
  });

  it('leaves sortVersion alone when the sort does not actually change', async () => {
    function Harness() {
      const { sortVersion, applySort } = useTableSort(ROWS, ACCESSORS);
      return (
        <>
          <button type="button" onClick={() => applySort('name', 'asc')}>
            apply
          </button>
          <span data-testid="version">{sortVersion}</span>
        </>
      );
    }

    render(<Harness />);
    const version = () => Number(screen.getByTestId('version').textContent);

    await userEvent.click(screen.getByRole('button'));
    const afterFirst = version();

    // Re-applying the identical sort is a no-op, not a reordering.
    await userEvent.click(screen.getByRole('button'));
    expect(version()).toBe(afterFirst);
  });
});

describe('TableFilters', () => {
  it('filters rows by the search box', async () => {
    render(<FiltersHarness />);
    await userEvent.type(screen.getByLabelText('Search'), 'alph');
    expect(screen.getByLabelText('Search')).toHaveValue('alph');
  });

  it('gives every control in a row its own unique id', () => {
    render(
      <>
        <FiltersHarness />
        <FiltersHarness />
      </>,
    );
    screen.getAllByRole('button', { name: 'Filters' }).forEach((button) => fireEvent.click(button));
    const ids = screen.getAllByLabelText('Team').map((select) => select.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('offers the distinct column values and an all option', () => {
    render(<FiltersHarness />);
    expect(screen.queryByLabelText('Team')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    const select = screen.getByLabelText('Team') as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      'All teams',
      'Delivery',
      'Finance',
    ]);
  });

  it('reveals the clear action only once a filter is active', async () => {
    render(<FiltersHarness />);
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    expect(screen.queryByRole('button', { name: /Clear all/ })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Team'), 'Finance');
    const clear = screen.getByRole('button', { name: /Clear all/ });

    await userEvent.click(clear);
    expect(screen.getByLabelText('Team')).toHaveValue('');
  });

  it('keeps filters collapsed until requested while search and sort stay available', () => {
    render(
      <TableFilters
        search={{ value: '', onChange: () => {} }}
        selects={[
          { key: 'team', label: 'Team', value: '', onChange: () => {}, options: ['Delivery'] },
        ]}
        bespoke={[
          { key: 'from', label: 'From', content: <input aria-label="From" /> },
          { key: 'to', label: 'To', content: <input aria-label="To" /> },
        ]}
        sort={{
          options: [{ key: 'name', label: 'Name' }],
          sortKey: null,
          sortDir: null,
          onChange: () => {},
        }}
        onClear={() => {}}
        hasActiveFilters
      />,
    );

    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    expect(screen.getByLabelText('Sort by')).toBeInTheDocument();
    expect(screen.queryByLabelText('Team')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('From')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    expect(screen.getByLabelText('Team')).toBeInTheDocument();
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    expect(screen.getByLabelText('To')).toBeInTheDocument();
  });

  it('shows selected values as removable chips', async () => {
    render(<FiltersHarness />);
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    await userEvent.selectOptions(screen.getByLabelText('Team'), 'Finance');

    const removeTeam = screen.getByRole('button', { name: 'Remove Team filter' });
    expect(removeTeam).toHaveTextContent('Team:');
    expect(screen.getByRole('button', { name: /Filters, 1 active filter/ })).toBeInTheDocument();

    await userEvent.click(removeTeam);
    expect(screen.getByLabelText('Team')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Remove Team filter' })).not.toBeInTheDocument();
  });
});

describe('FullscreenTable', () => {
  it('keeps table actions on one line without clipping action menus', async () => {
    render(
      <FullscreenTable
        title="Ledger"
        actions={
          <ColumnsMenu columns={[{ key: 'name', label: 'Name' }]} hidden={new Set<string>()} onToggle={() => {}} onShowAll={() => {}} />
        }
      >
        <table>
          <tbody />
        </table>
      </FullscreenTable>
    );

    const actions = screen.getByRole('group', { name: 'Table actions' });
    expect((actions as HTMLElement).style.flexWrap).toBe('nowrap');
    expect((actions as HTMLElement).style.overflowX).toBe('');
    expect((actions as HTMLElement).style.flexShrink).toBe('0');

    await userEvent.click(screen.getByTitle('Choose visible columns'));
    expect(screen.getByText('Visible columns')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Name' })).toBeInTheDocument();
  });

  it('uses a compact export button while keeping its accessible label', () => {
    render(
      <ExportButton
        filename="rows"
        columns={[{ key: 'name', label: 'Name', value: (row: Row) => row.name }]}
        rows={ROWS}
      />
    );

    const button = screen.getByRole('button', { name: 'Export' });
    expect(button).toHaveClass('px-2', 'text-xs');
    expect(button).toHaveTextContent('Export');
  });

  it('uses a compact copy button while keeping its accessible label', () => {
    render(
      <CopyButton
        columns={[{ key: 'name', label: 'Name', value: (row: Row) => row.name }]}
        rows={ROWS}
      />
    );

    const button = screen.getByRole('button', { name: 'Copy' });
    expect(button).toHaveClass('px-2', 'text-xs');
    expect(button).toHaveTextContent('Copy');
  });

  it('disables the copy button when there are no rows', () => {
    render(
      <CopyButton
        columns={[{ key: 'name', label: 'Name', value: (row: Row) => row.name }]}
        rows={[]}
      />
    );

    const button = screen.getByRole('button', { name: 'Copy' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Nothing to copy with the current filters');
  });

  it('portals fixed fullscreen above the page and exits on Escape', async () => {
    const { container } = render(
      <FullscreenTable title="Ledger">
        <table>
          <tbody>
            <tr>
              <td>row</td>
            </tr>
          </tbody>
        </table>
      </FullscreenTable>
    );

    expect(container.querySelector('[data-fullscreen="false"]')).not.toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /Full Screen/ }));
    const panel = document.body.querySelector<HTMLElement>('[data-fullscreen="true"]');
    expect(panel).not.toBeNull();
    expect(panel?.parentElement).toBe(document.body);
    expect(panel?.style.position).toBe('fixed');
    expect(document.body.style.overflow).toBe('hidden');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(container.querySelector('[data-fullscreen="false"]')).not.toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('falls back to the expanded panel when native fullscreen is denied', async () => {
    const { container } = render(
      <FullscreenTable nativeFullscreen title="Ledger">
        <table>
          <tbody />
        </table>
      </FullscreenTable>
    );
    const panel = container.querySelector<HTMLElement>('[data-fullscreen="false"]');
    expect(panel).not.toBeNull();
    Object.defineProperty(panel, 'requestFullscreen', {
      configurable: true,
      value: () => Promise.reject(new Error('Fullscreen permission denied')),
    });

    await userEvent.click(screen.getByRole('button', { name: /Full Screen/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Fullscreen notice: Browser fullscreen was unavailable; using expanded view instead. Fullscreen permission denied'
    );
    const expandedPanel = document.body.querySelector<HTMLElement>('[data-fullscreen="true"]');
    expect(expandedPanel).not.toBeNull();
    expect(expandedPanel?.style.position).toBe('fixed');

    await userEvent.click(screen.getByRole('button', { name: /Exit Full Screen/ }));
    expect(container.querySelector('[data-fullscreen="false"]')).not.toBeNull();
  });

  it('keeps the fullscreen button out of the way when hidden', () => {
    render(
      <FullscreenTable showFullscreenButton={false} toolbar={<span>toolbar</span>}>
        <table>
          <tbody />
        </table>
      </FullscreenTable>
    );
    expect(screen.queryByRole('button', { name: /Full Screen/ })).not.toBeInTheDocument();
    expect(screen.getByText('toolbar')).toBeInTheDocument();
  });

  it('keeps its header rows intact when headerStyle tries to own the layout', () => {
    const { container } = render(
      <FullscreenTable
        title="Ledger"
        // A caller can theme the padding/border, but must not be able to
        // collapse the header rows or reorder the toolbar and actions.
        headerStyle={{
          padding: '20px 24px',
          borderBottom: '1px solid red',
          display: 'grid',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
        }}
        toolbar={<span>toolbar</span>}
        actions={<button type="button">Do the thing</button>}
      >
        <table>
          <tbody />
        </table>
      </FullscreenTable>
    );

    const header = container.querySelector<HTMLElement>('[style*="border-bottom"]') as HTMLElement;
    expect(header).not.toBeNull();
    expect(header.style.flexDirection).toBe('column');
    expect(header.style.alignItems).toBe('stretch');
    expect(header.style.display).toBe('flex');
    // The caller's theme still applies.
    expect(header.style.padding).toBe('20px 24px');
    expect(header.style.borderBottom).toBe('1px solid red');

    // Title sits on its own line; the toolbar and the actions share the row
    // underneath it so a table's primary button lines up with its filters.
    const title = screen.getByText('Ledger');
    const toolbarControl = screen.getByText('toolbar');
    const toolbarRow = header.lastElementChild as HTMLElement;
    expect(title.parentElement).toBe(header);
    expect(header.children).toHaveLength(2);
    expect(toolbarRow.contains(toolbarControl)).toBe(true);
    expect(toolbarRow.contains(screen.getByRole('button', { name: 'Do the thing' }))).toBe(true);
  });
});