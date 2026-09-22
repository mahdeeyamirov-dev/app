import SwiftUI

/// Compact leaderboard: one row per participant, sorted by today's % of green base metrics.
struct DailyRankingView: View {
    let participants: [ParticipantSnapshot]
    let onSelect: (ParticipantSnapshot) -> Void

    var body: some View {
        if participants.isEmpty {
            ContentUnavailableView(
                "Пока нет данных",
                systemImage: "list.number",
                description: Text("В этой группе пока нет участников. Они появятся, когда выберут группу в боте")
            )
        } else {
            let ranks = DashboardStyle.ranks(for: participants.map(\.percentGreen))
            List {
                Section {
                    GroupSummaryView(participants: participants)
                        .listRowSeparator(.hidden)
                }

                Section {
                    ForEach(Array(participants.enumerated()), id: \.element.id) { index, participant in
                        Button {
                            onSelect(participant)
                        } label: {
                            row(participant, rank: ranks[index])
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func tooltip(_ metric: BaseMetricStatus) -> String {
        let value = "\(metric.name): \(DashboardStyle.valueText(metric.value, hasValue: metric.hasValue)) / \(DashboardStyle.formatValue(metric.minValue))"
        guard let period = DashboardStyle.periodText(start: metric.periodStart, end: metric.periodEnd) else { return value }
        return value + " · за \(period)"
    }

    private func row(_ participant: ParticipantSnapshot, rank: Int) -> some View {
        HStack(spacing: 12) {
            RankBadge(rank: rank)

            VStack(alignment: .leading, spacing: 4) {
                Text(participant.displayName)
                    .font(.body)
                HStack(spacing: 4) {
                    ForEach(participant.metrics) { metric in
                        Circle()
                            .fill(DashboardStyle.statusColor(metric))
                            .frame(width: 8, height: 8)
                            .help(tooltip(metric))
                    }
                }
                Text(DashboardStyle.lastUpdatedText(participant.lastUpdatedAt))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            Spacer()

            Text("\(participant.percentGreen)%")
                .font(.title3.bold())
                .foregroundStyle(DashboardStyle.percentColor(participant.percentGreen))

            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}
