import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type {
  CreateRoutingRouteInput,
  RoutingModelView,
  RoutingRouteView,
  UpdateRoutingRouteInput,
} from '../../../../../../shared/routing.js';
import { Badge, Button, Input } from '../../../../../shared/view/ui';

import {
  addRouteTarget,
  isValidRouteName,
  moveRouteTarget,
  removeRouteTarget,
  serializeRouteTargets,
} from './routeEditorState.js';

type RouteEditorProps = {
  routes: RoutingRouteView[];
  models: RoutingModelView[];
  boundRouteIds: Set<string>;
  canWrite: boolean;
  activeMutation: string | null;
  onCreate: (input: CreateRoutingRouteInput) => Promise<boolean>;
  onUpdate: (id: string, input: UpdateRoutingRouteInput) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  defaultAdding?: boolean;
  defaultEditingRouteId?: string | null;
  defaultDeleteId?: string | null;
};

type RouteDraft = {
  name: string;
  models: string[];
};

type RouteFormProps = {
  idPrefix: string;
  draft: RouteDraft;
  models: RoutingModelView[];
  busy: boolean;
  saving: boolean;
  onChange: (draft: RouteDraft) => void;
  onCancel: () => void;
  onSave: () => void;
};

function routeDraft(route?: RoutingRouteView): RouteDraft {
  return { name: route?.name ?? '', models: [...(route?.models ?? [])] };
}

function RouteForm({
  idPrefix,
  draft,
  models,
  busy,
  saving,
  onChange,
  onCancel,
  onSave,
}: RouteFormProps) {
  const { t } = useTranslation('settings');
  const [search, setSearch] = useState('');
  const modelById = useMemo(() => new Map(models.map((model) => [model.id, model])), [models]);
  const normalizedSearch = search.trim().toLowerCase();
  const available = models.filter((model) => (
    !draft.models.includes(model.id)
      && (!normalizedSearch || [model.id, model.name, model.provider].some((value) => (
        value.toLowerCase().includes(normalizedSearch)
      )))
  ));
  const validName = isValidRouteName(draft.name.trim());
  const canSave = validName && draft.models.length > 0 && !busy;

  return (
    <div className="space-y-4 rounded-lg border border-border bg-background p-4">
      <div className="space-y-2">
        <label htmlFor={`${idPrefix}-name`} className="text-xs font-medium text-foreground">
          {t('nineRouter.management.routes.name')}
        </label>
        <Input
          id={`${idPrefix}-name`}
          value={draft.name}
          maxLength={256}
          pattern="[a-zA-Z0-9_.-]+"
          aria-invalid={Boolean(draft.name) && !validName}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
          disabled={busy}
        />
        <p className={Boolean(draft.name) && !validName ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
          {t('nineRouter.management.routes.nameHelp')}
        </p>
      </div>

      <div className="space-y-2">
        <span className="text-xs font-medium text-foreground">
          {t('nineRouter.management.routes.orderedModels')}
        </span>
        {draft.models.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
            {t('nineRouter.management.routes.noSelectedModels')}
          </p>
        ) : (
          <ol className="divide-y divide-border rounded-md border border-border">
            {draft.models.map((modelId, index) => {
              const model = modelById.get(modelId);
              const label = model?.name ?? modelId;
              return (
                <li key={`${modelId}-${index}`} className="flex items-center gap-2 p-2">
                  <span className="w-5 flex-shrink-0 text-center text-xs tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{label}</span>
                  {model && <span className="hidden text-xs text-muted-foreground sm:inline">{model.provider}</span>}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    aria-label={t('nineRouter.management.routes.moveUp', { model: label })}
                    onClick={() => onChange({ ...draft, models: moveRouteTarget(draft.models, index, -1) })}
                    disabled={busy || index === 0}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    aria-label={t('nineRouter.management.routes.moveDown', { model: label })}
                    onClick={() => onChange({ ...draft, models: moveRouteTarget(draft.models, index, 1) })}
                    disabled={busy || index === draft.models.length - 1}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    aria-label={t('nineRouter.management.routes.removeModel', { model: label })}
                    onClick={() => onChange({ ...draft, models: removeRouteTarget(draft.models, index) })}
                    disabled={busy}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="space-y-2">
        <label htmlFor={`${idPrefix}-search`} className="text-xs font-medium text-foreground">
          {t('nineRouter.management.routes.addModel')}
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            id={`${idPrefix}-search`}
            type="search"
            className="pl-9"
            value={search}
            placeholder={t('nineRouter.management.routes.searchModels')}
            onChange={(event) => setSearch(event.target.value)}
            disabled={busy}
          />
        </div>
        <div className="max-h-40 divide-y divide-border overflow-y-auto rounded-md border border-border">
          {available.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">{t('nineRouter.management.routes.noMatchingModels')}</p>
          ) : available.map((model) => (
            <button
              key={model.id}
              type="button"
              className="flex w-full items-center justify-between gap-3 p-2 text-left hover:bg-accent/50 disabled:opacity-50"
              onClick={() => onChange({ ...draft, models: addRouteTarget(draft.models, model.id) })}
              disabled={busy}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm text-foreground">{model.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{model.provider} · {model.id}</span>
              </span>
              <Plus className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          {t('nineRouter.management.actions.cancel')}
        </Button>
        <Button type="button" size="sm" onClick={onSave} disabled={!canSave}>
          {saving && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
          {t('nineRouter.management.actions.save')}
        </Button>
      </div>
    </div>
  );
}

export default function RouteEditor({
  routes,
  models,
  boundRouteIds,
  canWrite,
  activeMutation,
  onCreate,
  onUpdate,
  onDelete,
  defaultAdding = false,
  defaultEditingRouteId = null,
  defaultDeleteId = null,
}: RouteEditorProps) {
  const { t } = useTranslation('settings');
  const initialRoute = routes.find((route) => route.id === defaultEditingRouteId);
  const [adding, setAdding] = useState(defaultAdding);
  const [createDraft, setCreateDraft] = useState<RouteDraft>(() => routeDraft());
  const [editingId, setEditingId] = useState<string | null>(initialRoute?.id ?? null);
  const [editDraft, setEditDraft] = useState<RouteDraft>(() => routeDraft(initialRoute));
  const [deleteId, setDeleteId] = useState<string | null>(defaultDeleteId);
  const busy = activeMutation !== null;

  const createRoute = async () => {
    const created = await onCreate({
      name: createDraft.name.trim(),
      models: serializeRouteTargets(createDraft.models),
    });
    if (created) {
      setCreateDraft(routeDraft());
      setAdding(false);
    }
  };

  const saveRoute = async (id: string) => {
    const updated = await onUpdate(id, {
      name: editDraft.name.trim(),
      models: serializeRouteTargets(editDraft.models),
    });
    if (updated) setEditingId(null);
  };

  return (
    <section aria-labelledby="nine-router-routes-title" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h3 id="nine-router-routes-title" className="text-sm font-semibold text-foreground">
            {t('nineRouter.management.routes.title')}
          </h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t('nineRouter.management.routes.description')}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setAdding(true)}
          disabled={!canWrite || busy || adding || models.length === 0}
        >
          <Plus className="h-4 w-4" />
          {t('nineRouter.management.routes.add')}
        </Button>
      </div>

      {adding && (
        <RouteForm
          idPrefix="nine-router-new-route"
          draft={createDraft}
          models={models}
          busy={busy}
          saving={activeMutation === 'route:create'}
          onChange={setCreateDraft}
          onCancel={() => {
            setCreateDraft(routeDraft());
            setAdding(false);
          }}
          onSave={() => { void createRoute(); }}
        />
      )}

      {routes.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          {t('nineRouter.management.routes.empty')}
        </p>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-background">
          {routes.map((route) => {
            const editing = editingId === route.id;
            const deleting = deleteId === route.id;
            const bound = boundRouteIds.has(route.id);
            return (
              <div key={route.id} className="space-y-3 p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{route.name}</span>
                      {route.kind && <Badge variant="outline">{route.kind}</Badge>}
                      {bound && <Badge variant="outline">{t('nineRouter.management.routes.inUse')}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('nineRouter.management.routes.modelCount', { count: route.models.length })}
                    </p>
                  </div>
                  {canWrite && (
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditDraft(routeDraft(route));
                          setEditingId(route.id);
                        }}
                        disabled={busy || editing}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        {t('nineRouter.management.actions.edit')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleteId(route.id)}
                        disabled={busy || deleting}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t('nineRouter.management.actions.delete')}
                      </Button>
                    </div>
                  )}
                </div>

                {editing && (
                  <section aria-label={t('nineRouter.management.routes.editLabel', { name: route.name })}>
                    <RouteForm
                      idPrefix={`nine-router-route-${route.id}`}
                      draft={editDraft}
                      models={models}
                      busy={busy}
                      saving={activeMutation === `route:update:${route.id}`}
                      onChange={setEditDraft}
                      onCancel={() => setEditingId(null)}
                      onSave={() => { void saveRoute(route.id); }}
                    />
                  </section>
                )}

                {deleting && (
                  <div role="alert" className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm text-foreground">
                        {t('nineRouter.management.routes.confirmDelete', { name: route.name })}
                      </p>
                      {bound && (
                        <p className="text-xs text-destructive">
                          {t('nineRouter.management.routes.boundWarning')}
                        </p>
                      )}
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button type="button" size="sm" variant="ghost" onClick={() => setDeleteId(null)} disabled={busy}>
                        {t('nineRouter.management.actions.cancel')}
                      </Button>
                      <Button type="button" size="sm" variant="destructive" onClick={() => {
                        void onDelete(route.id).then((deleted) => {
                          if (deleted) setDeleteId(null);
                        });
                      }} disabled={busy}>
                        {t('nineRouter.management.actions.confirmDelete')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
