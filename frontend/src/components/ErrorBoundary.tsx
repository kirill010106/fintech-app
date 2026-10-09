import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Result, Typography } from 'antd';
import { ReloadOutlined, HomeOutlined } from '@ant-design/icons';

const { Text, Paragraph } = Typography;

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Ошибка отображения раздела:', error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  handleHome = () => {
    this.setState({ hasError: false, error: null });
    window.location.assign('/');
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="page" style={{ paddingTop: 24 }}>
          <div className="app-card" style={{ padding: 8 }}>
            <Result
              status="warning"
              title="Не удалось отобразить раздел"
              subTitle="Попробуйте обновить страницу. Данные не потеряны."
              extra={[
                <Button key="reload" type="primary" icon={<ReloadOutlined />} onClick={this.handleReload}>
                  Обновить
                </Button>,
                <Button key="home" icon={<HomeOutlined />} onClick={this.handleHome}>
                  На главную
                </Button>,
              ]}
            >
              {this.state.error && (
                <div
                  className="app-panel"
                  style={{ textAlign: 'left', padding: 16, borderColor: 'var(--danger)' }}
                >
                  <Text strong style={{ color: 'var(--danger-text)' }}>
                    {this.state.error.name}: {this.state.error.message}
                  </Text>
                  {this.state.error.stack && (
                    <Paragraph
                      code
                      style={{
                        fontSize: 11,
                        marginTop: 8,
                        marginBottom: 0,
                        maxHeight: 180,
                        overflow: 'auto',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {this.state.error.stack}
                    </Paragraph>
                  )}
                </div>
              )}
            </Result>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
