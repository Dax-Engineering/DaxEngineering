'use client';

import {
  Alert,
  Button,
  FileInput,
  Group,
  List,
  ListItem,
  Radio,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import { startTransition, useActionState, useState } from 'react';
import { Mono, Pill, SectionCard, ScrollTable } from '@dax/web-shell';
import type {
  ImportKind,
  ImportMode,
  ImportModeOption,
  ImportState,
} from '../lib/import';
import { runImport } from '../lib/import-actions';
import { AppLink } from './links';

const IDLE: ImportState = { ok: false };

export function ImportScreen({
  kind,
  noun,
  columns,
  notes,
  backHref,
  modes,
}: {
  kind: ImportKind;
  noun: string;
  columns: readonly string[];
  notes: string[];
  backHref: string;
  /** Offer a choice between adding only and also updating existing rows. */
  modes?: ImportModeOption[];
}) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ImportMode>(modes?.[0]?.value ?? 'add');
  const [sent, setSent] = useState<{
    file: File;
    mode: ImportMode;
  } | null>(null);
  const [state, dispatch, pending] = useActionState(runImport, IDLE);
  const current =
    sent && sent.file === file && sent.mode === mode ? state : IDLE;
  const modeNotes = modes?.find((m) => m.value === mode)?.notes ?? [];
  const allNotes = [...notes, ...modeNotes];
  const plural = (n: number) => (n === 1 ? noun : `${noun}s`);
  const result = current.result;
  const ready = result?.dryRun === true && result.errors.length === 0;
  const done = result?.dryRun === false && result.errors.length === 0;

  function send(dryRun: boolean) {
    if (!file) return;
    const form = new FormData();
    form.set('kind', kind);
    form.set('file', file);
    form.set('dryRun', String(dryRun));
    form.set('mode', mode);
    setSent({ file, mode });
    startTransition(() => dispatch(form));
  }

  return (
    <Stack gap="lg">
      <SectionCard title="1. Get the template">
        <Stack gap="sm">
          <Text size="sm">
            Fill in one {noun} per row. Keep the first row of column names as it
            is.
          </Text>
          <div className="dax-chips" style={{ gap: 6 }}>
            {columns.map((c) => (
              <span key={c} className="dax-pill">
                <Mono>{c}</Mono>
              </span>
            ))}
          </div>
          {modes && modes.length > 1 ? (
            <Radio.Group
              label="What should the import do?"
              value={mode}
              onChange={(v) => setMode(v as ImportMode)}
            >
              <Stack gap={6} mt={6}>
                {modes.map((m) => (
                  <Radio key={m.value} value={m.value} label={m.label} />
                ))}
              </Stack>
            </Radio.Group>
          ) : null}
          {allNotes.length ? (
            <List size="sm" spacing={4}>
              {allNotes.map((n) => (
                <ListItem key={n}>{n}</ListItem>
              ))}
            </List>
          ) : null}
          <Group>
            <Button
              component="a"
              href={`/api/templates/${kind}`}
              variant="default"
              download
            >
              Download template
            </Button>
          </Group>
        </Stack>
      </SectionCard>

      <SectionCard title="2. Check your file">
        <Stack gap="sm">
          <Text size="sm">
            Nothing is saved yet. We read the file and list any rows that need
            fixing. Files can be up to 2 MB.
          </Text>
          <FileInput
            label="CSV file"
            placeholder="Choose a .csv file"
            accept=".csv,text/csv"
            value={file}
            onChange={setFile}
            clearable
            size="md"
          />
          <Group>
            <Button
              onClick={() => send(true)}
              disabled={!file || done}
              loading={pending && !ready}
            >
              Check file
            </Button>
          </Group>
          {current.error ? <Alert color="red">{current.error}</Alert> : null}
        </Stack>
      </SectionCard>

      {result ? (
        <SectionCard title="3. Import">
          <Stack gap="sm">
            {result.errors.length > 0 ? (
              <>
                <Alert color="red">
                  {result.errors.length}{' '}
                  {result.errors.length === 1 ? 'problem' : 'problems'} found in{' '}
                  {result.total} rows. Nothing was imported. Fix the file and
                  check it again.
                </Alert>
                <Table.ScrollContainer minWidth={420}>
                  <ScrollTable>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Row</Table.Th>
                        <Table.Th>Column</Table.Th>
                        <Table.Th>Problem</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {result.errors.map((e, i) => (
                        <Table.Tr key={`${e.row}-${e.field ?? ''}-${i}`}>
                          <Table.Td>{e.row}</Table.Td>
                          <Table.Td>
                            {e.field ? <Mono>{e.field}</Mono> : 'Whole row'}
                          </Table.Td>
                          <Table.Td>{e.message}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </ScrollTable>
                </Table.ScrollContainer>
              </>
            ) : null}
            {ready ? (
              <>
                <Text size="sm">
                  <Pill tone="ok">Ready</Pill> All {result.total} rows look
                  good.{' '}
                  {result.updated !== undefined && mode === 'upsert'
                    ? `${result.created} new ${plural(result.created)} to add, ${result.updated} to update${
                        result.total - result.created - result.updated > 0
                          ? `, ${result.total - result.created - result.updated} already up to date`
                          : ''
                      }. Importing saves them all at once; if anything fails, nothing is saved.`
                    : 'Importing adds them all at once; if anything fails, nothing is added.'}
                </Text>
                <Group>
                  <Button onClick={() => send(false)} loading={pending}>
                    Import {result.total} {result.total === 1 ? 'row' : 'rows'}
                  </Button>
                </Group>
              </>
            ) : null}
            {done ? (
              <Alert color="green">
                {result.updated
                  ? `Added ${result.created} new ${plural(result.created)} and updated ${result.updated}.`
                  : `Imported ${result.created} ${plural(result.created)}.`}{' '}
                <AppLink href={backHref}>Back to the list</AppLink>
              </Alert>
            ) : null}
          </Stack>
        </SectionCard>
      ) : null}
    </Stack>
  );
}
