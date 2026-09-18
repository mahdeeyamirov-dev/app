import SwiftUI

/// Detailed card per participant showing every base metric's value against its minimum.
struct WeeklyRankingView: View {
    let participants: [ParticipantSnapshot]

    private let columns = [GridItem(.adaptive(minimum: 260), spacing: 16)]

    var body: some View {
        if participants.isEmpty {
            ContentUnavailableView(
                "Пока нет данных",
                systemImage: "square.grid.2x2",
                description: Text("Как только участники впишут значения боту, здесь появится подробная таблица")
            )
        } else {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 16) {
                    ForEach(participants) { participant in
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Text(participant.displayName)
                                    .font(.headline)
                                Spacer()
                                Text("\(participant.percentGreen)%")
                                    .font(.subheadline.bold())
                                    .foregroundStyle(percentColor(participant.percentGreen))
                            }

                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 6) {
                                ForEach(participant.metrics) { metric in
                                    HStack(spacing: 4) {
                                        Circle()
                                            .fill(metric.isGreen ? Color.green : Color.red)
                                            .frame(width: 6, height: 6)
                                        Text(metric.name)
                                            .font(.caption)
                                            .lineLimit(1)
                                        Spacer(minLength: 0)
                                        Text(formatValue(metric.value))
                                            .font(.caption.monospacedDigit())
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                        .padding(12)
                        .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 10))
                    }
                }
                .padding()
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

    private func formatValue(_ value: Double) -> String {
        value.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(value)) : String(format: "%.1f", value)
    }
}
