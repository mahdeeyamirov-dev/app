import Charts
import SwiftUI

/// Sheet opened by clicking a participant: every base metric's current value
/// against its minimum, plus a chart of how the value changed over time.
struct ParticipantDetailView: View {
    let participantID: Int
    let displayName: String
    let group: String
    let window: DashboardWindow

    @AppStorage("serverURL") private var serverURL = ""
    @AppStorage("apiToken") private var apiToken = ""
    @Environment(\.dismiss) private var dismiss

    @State private var detail: ParticipantDetail?
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(minWidth: 520, idealWidth: 560, minHeight: 560, idealHeight: 680)
        .task { await load() }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(displayName)
                    .font(.title2.bold())
                Text("Группа \(group) · \(window.title)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if let detail {
                    Text(DashboardStyle.lastUpdatedText(detail.lastUpdatedAt))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            if let detail {
                Text("\(detail.percentGreen)%")
                    .font(.title.bold())
                    .foregroundStyle(DashboardStyle.percentColor(detail.percentGreen))
            }
            Button("Закрыть") { dismiss() }
                .keyboardShortcut(.cancelAction)
                .padding(.leading, 12)
        }
        .padding()
    }

    @ViewBuilder
    private var content: some View {
        if let errorMessage {
            ContentUnavailableView(
                "Не удалось загрузить",
                systemImage: "wifi.exclamationmark",
                description: Text(errorMessage)
            )
        } else if let detail {
            ScrollView {
                VStack(spacing: 12) {
                    ForEach(detail.metrics) { metric in
                        MetricDetailCard(metric: metric)
                    }
                }
                .padding()
            }
        } else {
            ProgressView("Загрузка…")
        }
    }

    private func load() async {
        do {
            detail = try await DashboardService.fetchParticipant(
                id: participantID,
                group: group,
                window: window,
                serverURL: serverURL,
                apiToken: apiToken
            )
        } catch {
            errorMessage = DashboardService.message(for: error)
        }
    }
}

private struct MetricDetailCard: View {
    let metric: MetricWithHistory

    private var statusColor: Color {
        guard metric.hasValue else { return .gray }
        return metric.isGreen ? .green : .red
    }

    private var progress: Double {
        guard metric.minValue > 0 else { return 1 }
        return min(metric.value / metric.minValue, 1)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 8, height: 8)
                Text(metric.name)
                    .font(.headline)
                if let period = DashboardStyle.periodText(start: metric.periodStart, end: metric.periodEnd) {
                    Text("за \(period)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(DashboardStyle.valueText(metric.value, hasValue: metric.hasValue))
                    .font(.title3.bold().monospacedDigit())
                    .foregroundStyle(statusColor)
                Text("/ \(DashboardStyle.formatValue(metric.minValue))")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            ProgressView(value: progress)
                .tint(statusColor)

            if metric.entries.count >= 2 {
                historyChart
            } else if metric.entries.isEmpty {
                Text("Значение ещё не вносилось")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                Text("Пока одно значение — график появится после следующего обновления")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(12)
        .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 10))
    }

    private var historyChart: some View {
        Chart {
            ForEach(metric.entries, id: \.self) { entry in
                LineMark(
                    x: .value("Конец периода", entry.periodEndDate),
                    y: .value(metric.name, entry.value)
                )
                .interpolationMethod(.stepEnd)
                .foregroundStyle(.secondary)

                PointMark(
                    x: .value("Конец периода", entry.periodEndDate),
                    y: .value(metric.name, entry.value)
                )
                .foregroundStyle(entry.value >= metric.minValue ? Color.green : Color.red)
            }

            RuleMark(y: .value("Минимум", metric.minValue))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
                .foregroundStyle(.secondary)
                .annotation(position: .top, alignment: .leading) {
                    Text("минимум")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
        }
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                AxisGridLine()
                AxisValueLabel(format: .dateTime.day().month(.abbreviated).locale(Locale(identifier: "ru_RU")))
            }
        }
        .frame(height: 110)
    }
}
