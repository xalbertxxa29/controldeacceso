import Chart from 'chart.js/auto';

// Variables privadas del módulo
let dailyChartInstance = null;
let peopleChartInstance = null;

/**
 * Renderiza los gráficos del dashboard a partir de los datos proporcionados.
 * @param {Array} data - Lista de registros de acceso.
 */
export function renderizarGraficos(data) {
    const ctxDaily = document.getElementById('dailyChart');
    const ctxPeople = document.getElementById('peopleChart');

    if (!ctxDaily || !ctxPeople) return;

    // 1. Procesar datos para gráfico diario (Ingresos vs Salidas por día)
    const dailyStats = {};

    data.forEach(reg => {
        // Ingresos
        if (reg.timestamp) {
            const date = reg.timestamp.toDate();
            const dateStr = date.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
            if (!dailyStats[dateStr]) dailyStats[dateStr] = { ingreso: 0, salida: 0 };
            dailyStats[dateStr].ingreso++;
        }
        // Salidas
        if (reg.fechaSalida) {
            const dateS = reg.fechaSalida.toDate();
            const dateStrS = dateS.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
            if (!dailyStats[dateStrS]) dailyStats[dateStrS] = { ingreso: 0, salida: 0 };
            dailyStats[dateStrS].salida++;
        }
    });

    const labels = Object.keys(dailyStats).sort((a, b) => {
        const [d1, m1, y1] = a.split('/').map(Number);
        const [d2, m2, y2] = b.split('/').map(Number);
        return (y1 - y2) || (m1 - m2) || (d1 - d2);
    });
    const dataIngresos = labels.map(day => dailyStats[day].ingreso);
    const dataSalidas = labels.map(day => dailyStats[day].salida);

    if (dailyChartInstance) dailyChartInstance.destroy();

    dailyChartInstance = new Chart(ctxDaily, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Ingresos',
                    data: dataIngresos,
                    backgroundColor: 'rgba(0, 255, 136, 0.7)',
                    borderColor: '#00ff88',
                    borderWidth: 1,
                    borderRadius: 4
                },
                {
                    label: 'Salidas',
                    data: dataSalidas,
                    backgroundColor: 'rgba(255, 51, 102, 0.7)',
                    borderColor: '#ff3366',
                    borderWidth: 1,
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: {
                    bottom: 30, // Espacio extra para las fechas del eje X
                    top: 20
                }
            },
            plugins: {
                legend: { labels: { color: '#fff', font: { weight: 'bold' } } },
                tooltip: { backgroundColor: 'rgba(10, 14, 39, 0.9)' }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { color: '#aaa' },
                    grid: { color: 'rgba(255,255,255,0.05)' }
                },
                x: {
                    ticks: {
                        color: '#ffffff',
                        font: { weight: 'bold', size: 10 },
                        autoSkip: false,
                        maxRotation: 45,
                        minRotation: 45
                    },
                    grid: { display: false }
                }
            }
        },
        plugins: [{
            id: 'datalabels',
            afterDraw: (chart) => {
                const ctx = chart.ctx;
                chart.data.datasets.forEach((dataset, i) => {
                    const meta = chart.getDatasetMeta(i);
                    meta.data.forEach((bar, index) => {
                        const data = dataset.data[index];
                        if (data > 0) {
                            ctx.fillStyle = '#fff';
                            ctx.font = 'bold 12px sans-serif';
                            ctx.textAlign = 'center';
                            ctx.fillText(data, bar.x, bar.y - 10);
                        }
                    });
                });
            }
        }]
    });

    // 2. Procesar datos para gráfico de personas
    const peopleStats = { contratista: 0, cliente: 0, visita: 0 };
    data.forEach(reg => {
        const tipo = reg.tipoPersona ? reg.tipoPersona.toLowerCase() : 'otros';
        if (peopleStats[tipo] !== undefined) {
            peopleStats[tipo]++;
        } else {
            if (!peopleStats['otros']) peopleStats['otros'] = 0;
            peopleStats['otros']++;
        }
    });

    const totalPeople = Object.values(peopleStats).reduce((a, b) => a + b, 0);

    if (peopleChartInstance) peopleChartInstance.destroy();

    peopleChartInstance = new Chart(ctxPeople, {
        type: 'doughnut',
        data: {
            labels: ['Contratista', 'Cliente', 'Visita'],
            datasets: [{
                data: [peopleStats.contratista, peopleStats.cliente, peopleStats.visita],
                backgroundColor: [
                    'rgba(0, 217, 255, 0.8)',
                    'rgba(255, 235, 59, 0.8)',
                    'rgba(255, 255, 255, 0.8)'
                ],
                borderColor: 'rgba(10, 14, 39, 1)',
                borderWidth: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: 10
            },
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: '#fff',
                        padding: 15,
                        font: { size: 11, weight: 'bold' },
                        boxWidth: 12
                    }
                }
            },
            cutout: '65%'
        },
        plugins: [{
            id: 'pieLabels',
            afterDraw: (chart) => {
                const ctx = chart.ctx;
                const canvasHeight = chart.canvas.height;
                const canvasWidth = chart.canvas.width;

                chart.data.datasets[0].data.forEach((val, i) => {
                    if (val === 0) return;
                    const meta = chart.getDatasetMeta(0);
                    const arc = meta.data[i];
                    const center = arc.getCenterPoint();

                    const percentage = totalPeople > 0 ? ((val / totalPeople) * 100).toFixed(0) + '%' : '';

                    ctx.fillStyle = '#fff';
                    ctx.font = 'bold 11px sans-serif';
                    ctx.textAlign = 'center';
                    // Dibujar el valor arriba y el porcentaje abajo en el centro del arco
                    ctx.fillText(`${val}`, center.x, center.y - 2);
                    ctx.fillText(`${percentage}`, center.x, center.y + 10);
                });
            }
        }]
    });
}

let currentDashboardData = [];
let dashboardCurrentPage = 1;
const DASHBOARD_ITEMS_PER_PAGE = 20;
let paginationListenersAttached = false;

/**
 * Actualiza la tabla del dashboard con los datos proporcionados y maneja la paginación.
 * @param {Array} data - Lista de registros de acceso filtrados.
 */
export function actualizarTablaDashboard(data) {
    currentDashboardData = data;
    dashboardCurrentPage = 1;
    renderDashboardTablePage();
}

function renderDashboardTablePage() {
    const tbody = document.getElementById('dashboardTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    const pagination = document.getElementById('dashboardPagination');
    if (currentDashboardData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding: 2rem;">No hay datos en este rango</td></tr>';
        if (pagination) pagination.style.display = 'none';
        return;
    }

    const totalPages = Math.ceil(currentDashboardData.length / DASHBOARD_ITEMS_PER_PAGE);
    const startIndex = (dashboardCurrentPage - 1) * DASHBOARD_ITEMS_PER_PAGE;
    const endIndex = startIndex + DASHBOARD_ITEMS_PER_PAGE;
    const displayData = currentDashboardData.slice(startIndex, endIndex);

    displayData.forEach(reg => {
        let fecha = 'N/A';
        if (reg.timestamp) {
            fecha = reg.timestamp.toDate().toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        }

        const tr = document.createElement('tr');

        let fechaSalida = '-';
        let permanencia = 'En curso';

        if (reg.fechaSalida) {
            fechaSalida = reg.fechaSalida.toDate().toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

            const inicio = reg.timestamp.toDate();
            const fin = reg.fechaSalida.toDate();
            const diffMs = fin - inicio;
            const hours = Math.floor(diffMs / (1000 * 60 * 60));
            const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

            permanencia = `${hours}h ${minutes}m`;
        }

        tr.innerHTML = `
            <td data-label="Fecha">${fecha}</td>
            <td data-label="Nro Documento">${reg.numeroDocumento}</td>
            <td data-label="Nombre">${reg.nombreCompleto}</td>
            <td data-label="Empresa">${reg.empresa || '-'}</td>
            <td data-label="Tipo">${reg.tipoPersona}</td>
            <td data-label="Cliente" style="color:var(--primary-cyan); font-weight:bold;">${reg.cliente || '-'}</td>
            <td data-label="Unidad">${reg.unidad || '-'}</td>
            <td data-label="Salida">${fechaSalida}</td>
            <td data-label="Permanencia">${permanencia}</td>
            <td data-label="Estado">
                <span class="status-badge ${reg.estado === 'Activo' ? 'active' : 'closed'}">
                    ${reg.estado}
                </span>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Paginación UI
    if (pagination) {
        if (totalPages > 1) {
            pagination.style.display = 'flex';
            document.getElementById('pageIndicator').textContent = `Página ${dashboardCurrentPage} de ${totalPages}`;
            document.getElementById('btnPrevPage').disabled = dashboardCurrentPage === 1;
            document.getElementById('btnNextPage').disabled = dashboardCurrentPage === totalPages;

            if (!paginationListenersAttached) {
                document.getElementById('btnPrevPage').addEventListener('click', () => {
                    if (dashboardCurrentPage > 1) {
                        dashboardCurrentPage--;
                        renderDashboardTablePage();
                    }
                });
                document.getElementById('btnNextPage').addEventListener('click', () => {
                    const maxPages = Math.ceil(currentDashboardData.length / DASHBOARD_ITEMS_PER_PAGE);
                    if (dashboardCurrentPage < maxPages) {
                        dashboardCurrentPage++;
                        renderDashboardTablePage();
                    }
                });
                paginationListenersAttached = true;
            }
        } else {
            pagination.style.display = 'none';
        }
    }
}
