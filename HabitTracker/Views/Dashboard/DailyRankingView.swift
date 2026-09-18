import SwiftUI

/// Compact leaderboard: one row per participant, sorted by today's % of green base metrics.
struct DailyRankingView: View {
    let participants: [ParticipantSnapshot]

    var body: some View {
        if participants.isEmpty {
            ContentUnavailableView(
                "Пока нет данных",
                systemImage: "list.number",
                description: Text("Как только участники впишут значения боту, здесь появится рейтинг")
            )
        } else {
            List {
                ForEach(Array(participants.enumerated()), id: \.element.id) { index, participant in
                    HStack(spacing: 12) {
                        Text("#\(index + 1)")
                            .font(.headline)
                            .foregroundStyle(.secondary)
                            .frame(width: 32, alignment: .leading)

                        VStack(alignment: .leading, spacing: 4) {
                            Text(participant.displayName)
                                .font(.body)
                            HStack(spacing: 4) {
                                ForEach(participant.metrics) { metric in
                                    Circle()
                                        .fill(metric.isGreen ? Color.green : Color.red)
                                        .frame(width: 8, height: 8)
                                }
                            }
                        }

                        Spacer()

                        Text("\(participant.percentGreen)%")
                            .font(.title3.bold())
                            .foregroundStyle(percentColor(participant.percentGreen))
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }

    private func percentColor(_ percent: Int) -> Color {
        switch percent {
        case 75...: return .green
        case 40..<75: return .orange
        default: return .red
        }
    }
}
