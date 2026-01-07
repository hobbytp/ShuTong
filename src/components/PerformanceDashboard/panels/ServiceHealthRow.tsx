/**
 * ServiceHealthRow - Traffic light overview of all services.
 */

import './ServiceHealthRow.css';

export type ServiceStatus = 'green' | 'yellow' | 'red' | 'unknown';

export interface ServiceHealth {
    name: string;
    status: ServiceStatus;
    tooltip?: string;
}

export interface ServiceHealthRowProps {
    services: ServiceHealth[];
}

const STATUS_EMOJI: Record<ServiceStatus, string> = {
    green: '🟢',
    yellow: '🟡',
    red: '🔴',
    unknown: '⚪',
};

import { useTranslation } from 'react-i18next';

export function ServiceHealthRow({ services }: ServiceHealthRowProps) {
    const { t } = useTranslation();
    return (
        <div className="service-health-row">
            <span className="service-health-label">{t('performance.service_health', 'Service Health')}</span>
            <div className="service-health-indicators">
                {services.map((service) => (
                    <div
                        key={service.name}
                        className="service-health-item"
                        title={service.tooltip || `${service.name}: ${service.status}`}
                    >
                        <span className="service-health-emoji">{STATUS_EMOJI[service.status]}</span>
                        <span className="service-health-name">{service.name}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
