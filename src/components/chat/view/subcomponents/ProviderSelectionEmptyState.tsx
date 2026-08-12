import React, { useCallback, useMemo, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';

import type {
  ProjectSession,
  ProviderModelsDefinition,
} from '../../../../types/app';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import { NextTaskBanner } from '../../../task-master';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
  Card,
} from '../../../../shared/view/ui';

import { CHAT_MODEL_PROVIDER } from './providerSelectionState';

const MOD_KEY =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

function modelSearchFilter(value: string, search: string): number {
  const haystack = value.toLowerCase();
  const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every((token) => haystack.includes(token)) ? 1 : 0;
}

type ProviderSelectionEmptyStateProps = {
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  codexModel: string;
  setCodexModel: (model: string) => void;
  codexModelCatalog?: ProviderModelsDefinition;
  providerModelsLoading: boolean;
  tasksEnabled: boolean;
  isTaskMasterInstalled: boolean | null;
  onShowAllTasks?: (() => void) | null;
  setInput: React.Dispatch<React.SetStateAction<string>>;
};

export default function ProviderSelectionEmptyState({
  selectedSession,
  currentSessionId,
  textareaRef,
  codexModel,
  setCodexModel,
  codexModelCatalog,
  providerModelsLoading,
  tasksEnabled,
  isTaskMasterInstalled,
  onShowAllTasks,
  setInput,
}: ProviderSelectionEmptyStateProps) {
  const { t } = useTranslation('chat');
  const [dialogOpen, setDialogOpen] = useState(false);
  const models = useMemo(() => codexModelCatalog?.OPTIONS ?? [], [codexModelCatalog]);

  const nextTaskPrompt = t('tasks.nextTaskPrompt', {
    defaultValue: 'Start the next task',
  });

  const currentModelLabel = useMemo(() => (
    models.find((model) => model.value === codexModel)?.label || codexModel
  ), [codexModel, models]);

  const handleModelSelect = useCallback((modelValue: string) => {
    setCodexModel(modelValue);
    localStorage.setItem('selected-provider', CHAT_MODEL_PROVIDER);
    localStorage.setItem('codex-model', modelValue);
    setDialogOpen(false);
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, [setCodexModel, textareaRef]);

  if (!selectedSession && !currentSessionId) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="w-full max-w-[34.25rem]">
          <div className="mb-8 text-center">
            <h2 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">
              {t('providerSelection.title')}
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {t('providerSelection.description')}
            </p>
          </div>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Card
                className="group mx-auto max-w-xs cursor-pointer border-border/60 transition-all duration-150 hover:border-border hover:shadow-md active:scale-[0.99]"
                role="button"
                tabIndex={0}
              >
                <div className="flex items-center gap-2 p-3">
                  <SessionProviderLogo provider={CHAT_MODEL_PROVIDER} className="h-5 w-5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-semibold text-foreground">Codex</span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="truncate text-xs text-foreground">{currentModelLabel}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {t('providerSelection.clickToChange', { defaultValue: 'Click to change model' })}
                    </p>
                  </div>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-y-0.5" />
                </div>
              </Card>
            </DialogTrigger>

            <DialogContent className="max-w-md overflow-hidden p-0">
              <DialogTitle>Model Selector</DialogTitle>
              <div className="border-b border-border/60 bg-muted/20 px-4 py-3">
                <p className="text-sm font-semibold text-foreground">Choose a model</p>
              </div>
              <Command filter={modelSearchFilter}>
                <CommandInput
                  placeholder={t('providerSelection.searchModels', { defaultValue: 'Search models...' })}
                />
                <CommandList className="max-h-[350px]">
                  <CommandEmpty>
                    {providerModelsLoading
                      ? t('providerSelection.loadingModels', { defaultValue: 'Loading models…' })
                      : t('providerSelection.noModelsFound', { defaultValue: 'No models found.' })}
                  </CommandEmpty>
                  {models.map((model) => (
                    <CommandItem
                      key={model.value}
                      value={`${model.label} ${model.description || ''}`}
                      onSelect={() => handleModelSelect(model.value)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{model.label}</div>
                      </div>
                      {codexModel === model.value && (
                        <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />
                      )}
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </DialogContent>
          </Dialog>

          <p className="mt-4 text-center text-sm text-muted-foreground/70">
            {t('providerSelection.readyPrompt.codex', { model: codexModel })}
          </p>

          <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground/60">
            <Trans
              ns="chat"
              i18nKey="providerSelection.pressToSearch"
              values={{ shortcut: MOD_KEY === '⌘' ? '⌘K' : 'Ctrl+K' }}
              components={{
                kbd: (
                  <kbd className="inline-flex items-center gap-0.5 rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px]" />
                ),
              }}
            />
          </p>

          {tasksEnabled && isTaskMasterInstalled && (
            <div className="mt-5">
              <NextTaskBanner
                onStartTask={() => setInput(nextTaskPrompt)}
                onShowAllTasks={onShowAllTasks}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (selectedSession) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-[34.25rem] px-6 text-center">
          <p className="mb-1.5 text-lg font-semibold text-foreground">
            {t('session.continue.title')}
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t('session.continue.description')}
          </p>

          {tasksEnabled && isTaskMasterInstalled && (
            <div className="mt-5">
              <NextTaskBanner
                onStartTask={() => setInput(nextTaskPrompt)}
                onShowAllTasks={onShowAllTasks}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
