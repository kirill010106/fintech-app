import React from 'react';
import { Button, Spin } from 'antd';
import {
  ExclamationCircleOutlined,
  InboxOutlined,
  ReloadOutlined,
} from '@ant-design/icons';

/**
 * The three states every data-bearing section can be in. They share one visual
 * language so a slow load or a failed request never looks like an empty page.
 */

interface LoadingBlockProps {
  label?: string;
  /** Fixed height keeps a section from collapsing and reflowing as it loads. */
  height?: number;
}

export const LoadingBlock: React.FC<LoadingBlockProps> = ({ label = 'Загрузка', height = 180 }) => (
  <div className="state-block" style={{ minHeight: height }} role="status" aria-live="polite">
    <Spin />
    <span className="state-text">{label}</span>
  </div>
);

interface EmptyStateProps {
  title: string;
  text?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  height?: number;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  text,
  icon,
  action,
  height = 180,
}) => (
  <div className="state-block" style={{ minHeight: height }}>
    <span className="state-icon" aria-hidden="true">
      {icon ?? <InboxOutlined />}
    </span>
    <span className="state-title">{title}</span>
    {text ? <span className="state-text">{text}</span> : null}
    {action}
  </div>
);

interface ErrorBlockProps {
  title?: string;
  text?: string;
  onRetry?: () => void;
  height?: number;
}

export const ErrorBlock: React.FC<ErrorBlockProps> = ({
  title = 'Не удалось загрузить данные',
  text,
  onRetry,
  height = 180,
}) => (
  <div className="state-block" style={{ minHeight: height }} role="alert">
    <span className="state-icon" style={{ color: 'var(--danger)' }} aria-hidden="true">
      <ExclamationCircleOutlined />
    </span>
    <span className="state-title">{title}</span>
    {text ? <span className="state-text">{text}</span> : null}
    {onRetry ? (
      <Button size="small" icon={<ReloadOutlined />} onClick={onRetry}>
        Повторить
      </Button>
    ) : null}
  </div>
);
