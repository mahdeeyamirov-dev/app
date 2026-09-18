import SwiftUI

/// Trend view: one row per participant with a small bar-chart of weekly % over the month.
struct MonthlyRankingView: View {
    let history: [ParticipantHistory]

    var body: some View {
        if history.isEmpty {
            ContentUnavailableView(
                "Пока нет данных",
                systemImage: "chart.bar",
                description: Text("История по неделям появится, как только участники начнут вносить значения")
            )
        } else {
            List(history) { participant in
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(participant.displayName)
                            .font(.body)
                        Text("Сейчас: \(participant.currentPercent)%")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    HStack(alignment: .bottom, spacing: 3) {
                        ForEach(Array(participant.weeklyPercents.enumerated()), id: \.offset) { _, percent in
                            RoundedRectangle(cornerRadius: 2)
                                .fill(barColor(percent))
                                .frame(width: 8, height: max(4, CGFloat(percent) / 100 * 36))
                        }
                    }
                    .frame(height: 36, alignment: .bottom)
                }
                .padding(.vertical, 4)
            }
        }
    }

    private func barColor(_ percent: Int) -> Color {
        switch percent {
        case 75...: return .green
        case 40..<75: return .orange
        default: return .red
        }
    }
}
