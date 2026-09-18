import Foundation

@MainActor
final class HabitStore: ObservableObject {
    @Published var habits: [Habit] = []

    private let fileURL: URL

    init() {
        let folder = FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("HabitTracker", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        fileURL = folder.appendingPathComponent("habits.json")
        load()
    }

    func addHabit(name: String, colorName: String) {
        guard !name.isEmpty else { return }
        habits.append(Habit(name: name, colorName: colorName))
        save()
    }

    func deleteHabit(_ habit: Habit) {
        habits.removeAll { $0.id == habit.id }
        save()
    }

    func toggleToday(_ habit: Habit) {
        guard let index = habits.firstIndex(where: { $0.id == habit.id }) else { return }
        let today = Calendar.current.startOfDay(for: Date())
        if habits[index].completedDays.contains(today) {
            habits[index].completedDays.remove(today)
        } else {
            habits[index].completedDays.insert(today)
        }
        save()
    }

    private func load() {
        guard let data = try? Data(contentsOf: fileURL) else { return }
        habits = (try? JSONDecoder().decode([Habit].self, from: data)) ?? []
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(habits) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }
}
