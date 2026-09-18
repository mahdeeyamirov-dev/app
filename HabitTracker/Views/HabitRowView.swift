import SwiftUI

struct HabitRowView: View {
    @EnvironmentObject private var store: HabitStore
    let habit: Habit

    private var isDoneToday: Bool {
        habit.isCompleted(on: Date())
    }

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(habit.color)
                .frame(width: 10, height: 10)

            VStack(alignment: .leading, spacing: 2) {
                Text(habit.name)
                    .font(.body)
                if habit.currentStreak > 0 {
                    Text("Серия: \(habit.currentStreak) \(dayWord(habit.currentStreak))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            Button {
                store.toggleToday(habit)
            } label: {
                Image(systemName: isDoneToday ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundStyle(isDoneToday ? habit.color : .secondary)
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 4)
    }

    private func dayWord(_ count: Int) -> String {
        let mod10 = count % 10
        let mod100 = count % 100
        if (11...14).contains(mod100) { return "дней" }
        switch mod10 {
        case 1: return "день"
        case 2, 3, 4: return "дня"
        default: return "дней"
        }
    }
}
