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
        if (!reg.timestamp) return;
        const day = reg.timestamp.toDate().getDate();

        if (!dailyStats[day]) dailyStats[day] = { ingreso: 0, salida: 0 };

        if (reg.tipoAcceso === 'ingreso') {
            dailyStats[day].ingreso++;
        } else {
            dailyStats[day].salida++;
        }
    });

    const labels = Object.keys(dailyStats).sort((a, b) => parseInt(a) - parseInt(b));
    const dataIngresos = labels.map(day => dailyStats[day].ingreso);
    const dataSalidas = labels.map(day => dailyStats[day].salida);

    if (dailyChartInstance) dailyChartInstance.destroy();

    dailyChartInstance = new Chart(ctxDaily, {
        type: 'bar',
        data: {
            labels: labels.map(l => `Día ${l}`),
            datasets: [
                {
                    label: 'Ingresos',
                    data: dataIngresos,
                    backgroundColor: 'rgba(0, 255, 136, 0.6)',
                    borderColor: '#00ff88',
                    borderWidth: 1
                },
                {
                    label: 'Salidas',
                    data: dataSalidas,
                    backgroundColor: 'rgba(255, 51, 102, 0.6)',
                    borderColor: '#ff3366',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#fff' } }
            },
            scales: {
                y: { ticks: { color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.1)' } },
                x: { ticks: { color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.1)' } }
            }
        }
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

    if (peopleChartInstance) peopleChartInstance.destroy();

    peopleChartInstance = new Chart(ctxPeople, {
        type: 'doughnut',
        data: {
            labels: ['Contratista', 'Cliente', 'Visita'],
            datasets: [{
                data: [peopleStats.contratista, peopleStats.cliente, peopleStats.visita],
                backgroundColor: [
                    'rgba(0, 217, 255, 0.7)', // Cyan
                    'rgba(255, 235, 59, 0.7)',  // Yellow
                    'rgba(255, 255, 255, 0.7)' // White
                ],
                borderColor: 'rgba(0,0,0,0.5)',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { color: '#fff' } }
            }
        }
    });
}

/**
 * Actualiza la tabla del dashboard con los datos proporcionados.
 * @param {Array} data - Lista de registros de acceso filtrados.
 */
export function actualizarTablaDashboard(data) {
    const tbody = document.getElementById('dashboardTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 2rem;">No hay datos en este rango</td></tr>';
        return;
    }

    const displayData = data.slice(0, 100);

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
}
