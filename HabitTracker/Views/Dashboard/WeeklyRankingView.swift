import SwiftUI

/// Detailed card per participant showing every base metric's value against its minimum.
struct WeeklyRankingView: View {
    let participants: [ParticipantSnapshot]
    let onSelect: (ParticipantSnapshot) -> Void

    private let columns = [GridItem(.adaptive(minimum: 260), spacing: 16)]

    var body: some View {
        if participants.isEmpty {
            ContentUnavailableView(
                "Пока нет данных",
                systemImage: "square.grid.2x2",
                description: Text("В этой группе пока нет участников. Они появятся, когда выберут группу в боте")
            )
        } else {
            let ranks = DashboardStyle.ranks(for: participants.map(\.percentGreen))
            ScrollView {
                GroupSummaryView(participants: participants)
                    .padding([.horizontal, .top])

                LazyVGrid(columns: columns, spacing: 16) {
                    ForEach(Array(participants.enumerated()), id: \.element.id) { index, participant in
                        Button {
                            onSelect(participant)
                        } label: {
                            card(participant, rank: ranks[index])
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding()
            }
        }
    }

    private func card(_ participant: ParticipantSnapshot, rank: Int) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                if let medal = DashboardStyle.medal(forRank: rank) {
                    Text(medal)
                }
                Text(participant.displayName)
                    .font(.headline)
                Spacer()
                Text("\(participant.percentGreen)%")
                    .font(.subheadline.bold())
                    .foregroundStyle(DashboardStyle.percentColor(participant.percentGreen))
            }

            VStack(spacing: 5) {
                ForEach(participant.metrics) { metric in
                    HStack(spacing: 4) {
                        Circle()
                            .fill(DashboardStyle.statusColor(metric))
                            .frame(width: 6, height: 6)
                        Text(metric.name)
                            .font(.caption)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        Text(DashboardStyle.valueText(metric.value, hasValue: metric.hasValue))
                            .font(.caption.monospacedDigit())
                        if let period = DashboardStyle.periodText(start: metric.periodStart, end: metric.periodEnd) {
                            Text("· \(period)")
                                .font(.caption2.monospacedDigit())
                                .foregroundStyle(.secondary)
                                .frame(width: 80, alignment: .leading)
                        } else {
                            Spacer().frame(width: 80)
                        }
                    }
                }
            }

            Text(DashboardStyle.lastUpdatedText(participant.lastUpdatedAt))
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(12)
        .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 10))
        .contentShape(RoundedRectangle(cornerRadius: 10))
    }
}
